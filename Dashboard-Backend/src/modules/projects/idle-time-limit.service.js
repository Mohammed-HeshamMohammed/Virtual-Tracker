import { buildRateBook, convertAmount, normalizeCurrency } from "../../lib/currency/convert.js";
import { getDisplayCurrencyPg, getRatesForRangePg } from "../../lib/postgres/currency-rates.service.js";
import { getSingleByMemberId } from "../../lib/postgres/member-data-store.js";
import { getClientBudgetPg } from "../../lib/postgres/clients-postgres.service.js";
import {
  getProjectBudgetPg,
  getProjectMemberLimitPg,
  listClientIdsForProjectPg,
  listProjectMembersPg,
} from "../../lib/postgres/projects-postgres.service.js";
import { clampIdleTimeSeconds, idleTimeLimit, isHoursBudget, isHoursLimit } from "./idle-time.js";

/** How long a limit is reused. The agent asks every ~15s; a budget, limit or
 *  rate change reaches it within this. */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5000;
const cache = new Map();

/** Exchange rates move daily; an hour is plenty. */
const CURRENCY_TTL_MS = 60 * 60_000;
let currencyContext = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isPayBased(basedOn) {
  return String(basedOn ?? "").toLowerCase().includes("pay");
}

/** A whole-project money budget - the only kind that needs a rate. */
function isMoneyBudget(budget) {
  return Boolean(budget) && Number(budget.cost) > 0 && !isHoursBudget(budget);
}

function isMoneyLimit(limit) {
  return Boolean(limit) && Number(limit.cost) > 0 && !isHoursLimit(limit);
}

async function loadCurrencyContext() {
  if (currencyContext && currencyContext.expiresAt > Date.now()) return currencyContext;
  const day = today();
  const [display, rows] = await Promise.all([getDisplayCurrencyPg(), getRatesForRangePg({ fromDay: day, toDay: day })]);
  currencyContext = { display: normalizeCurrency(display), book: buildRateBook(rows), day, expiresAt: Date.now() + CURRENCY_TTL_MS };
  return currencyContext;
}

/**
 * A member's hourly pay in the org's currency, which budgets and limits are
 * kept in. A rate paid in another currency is converted at today's exchange
 * rate; with no exchange rate for it yet, it is used as it stands.
 */
async function memberPayRate(memberId) {
  let row;
  try {
    row = await getSingleByMemberId(null, "pay_rates", memberId);
  } catch {
    return 0;
  }
  const rate = Number(row?.rate ?? 0);
  if (!(rate > 0)) return 0;
  const currency = normalizeCurrency(row?.currency);
  try {
    const ctx = await loadCurrencyContext();
    if (!currency || currency === ctx.display) return rate;
    const converted = convertAmount(ctx.book, { amount: rate, currency, day: ctx.day, to: ctx.display });
    return converted.converted && converted.amount > 0 ? converted.amount : rate;
  } catch {
    return rate;
  }
}

/** A bill-rate budget or limit is charged at the client's rate - the rate
 *  budget spend is counted at (resolveMemberHourlyRatePg). */
async function clientBillRate(clientIds) {
  const clientId = clientIds.find(Boolean);
  if (!clientId) return 0;
  return Number((await getClientBudgetPg(clientId))?.cost ?? 0);
}

/**
 * The idle time limits for a budget, the members who track against it, their
 * own limits on the project, and its client.
 *
 * Top level: the project's figure - what its one idle time setting has to fit
 * - with a pay-rate budget converted at the highest member rate, so nobody's
 * idle time can cost more than half. `members`: each member's own limit, which
 * is what tracking applies to them.
 *
 * `memberLimits` are project_member_limits rows: { member_id, type, based_on, cost, start_date }.
 */
export async function resolveIdleTimeLimit({ budget = null, memberIds = [], clientIds = [], memberLimits = [] }) {
  const members = [...new Set(memberIds.filter(Boolean).map(String))];
  // A member limit only counts for someone on the project.
  const limitByMember = new Map(
    memberLimits
      .filter((limit) => limit?.member_id && members.includes(String(limit.member_id)))
      .map((limit) => [String(limit.member_id), limit]),
  );
  const everyone = members;

  const payBudget = isMoneyBudget(budget) && isPayBased(budget.based_on);
  const billBudget = isMoneyBudget(budget) && !payBudget;
  const moneyLimits = [...limitByMember.values()].filter(isMoneyLimit);
  const needPay = payBudget || moneyLimits.some((limit) => isPayBased(limit.based_on));
  const needBill = billBudget || moneyLimits.some((limit) => !isPayBased(limit.based_on));

  const payRates = new Map(
    needPay ? await Promise.all(everyone.map(async (memberId) => [memberId, await memberPayRate(memberId)])) : [],
  );
  const billRate = needBill ? await clientBillRate(clientIds) : 0;
  const rateFor = (basedOn, memberId) => (isPayBased(basedOn) ? payRates.get(memberId) ?? 0 : billRate);

  const rateBasis = isMoneyBudget(budget) ? (payBudget ? "pay" : "bill") : null;
  const highestPay = members.reduce((max, memberId) => Math.max(max, payRates.get(memberId) ?? 0), 0);
  const project = idleTimeLimit({ budget, rate: payBudget ? highestPay : billBudget ? billRate : null });

  const memberDetails = everyone.map((memberId) => {
    const limit = limitByMember.get(memberId) ?? null;
    const detail = idleTimeLimit({
      budget,
      rate: isMoneyBudget(budget) ? rateFor(budget.based_on, memberId) : null,
      memberLimit: limit,
      memberLimitRate: isMoneyLimit(limit) ? rateFor(limit.based_on, memberId) : null,
    });
    // The rate named in the explanation is the one behind whichever limit
    // decided - or, when neither could be converted, the one that was missing.
    const limitRateBasis = isMoneyLimit(limit) ? (isPayBased(limit.based_on) ? "pay" : "bill") : null;
    const decidedByLimit =
      detail.source === "member_limit" || (detail.basis === "no_rate" && !isMoneyBudget(budget));
    return { memberId, ...detail, rateBasis: decidedByLimit ? limitRateBasis : rateBasis };
  });

  return { ...project, rateBasis, members: memberDetails };
}

/** One member's limit on a project (or, with no member, the project's). */
export async function getMemberIdleTimeLimit(projectId, memberId = null) {
  const key = `${projectId}:${memberId ?? "*"}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.limit;

  const budget = await getProjectBudgetPg(projectId);
  let limit;
  if (memberId) {
    const memberLimit = await getProjectMemberLimitPg(projectId, memberId);
    const needsClient =
      (isMoneyBudget(budget) && !isPayBased(budget.based_on)) ||
      (isMoneyLimit(memberLimit) && !isPayBased(memberLimit.based_on));
    const resolved = await resolveIdleTimeLimit({
      budget,
      memberIds: [memberId],
      clientIds: needsClient ? await listClientIdsForProjectPg(projectId) : [],
      // Tagged with the member it was looked up for, rather than trusting the row to say.
      memberLimits: memberLimit ? [{ ...memberLimit, member_id: String(memberId) }] : [],
    });
    limit = resolved.members.find((m) => m.memberId === String(memberId)) ?? resolved;
  } else {
    const payBudget = isMoneyBudget(budget) && isPayBased(budget.based_on);
    const [memberRows, clientIds] = await Promise.all([
      payBudget ? listProjectMembersPg(projectId) : Promise.resolve([]),
      isMoneyBudget(budget) && !payBudget ? listClientIdsForProjectPg(projectId) : Promise.resolve([]),
    ]);
    limit = await resolveIdleTimeLimit({ budget, memberIds: memberRows.map((row) => row.member_id), clientIds });
  }

  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(key, { limit, expiresAt: Date.now() + CACHE_TTL_MS });
  return limit;
}

/**
 * The idle time tracking actually uses for `memberId` on `project`: the
 * project's setting, held to that member's limit. If the limit can't be worked
 * out, the fallback hour applies rather than whatever was stored.
 */
export async function effectiveIdleTimeSeconds(project, memberId = null) {
  if (!project?.id) return clampIdleTimeSeconds(project?.idle_time_seconds);
  try {
    const limit = await getMemberIdleTimeLimit(project.id, memberId);
    return clampIdleTimeSeconds(project.idle_time_seconds, limit.maxSeconds);
  } catch {
    return clampIdleTimeSeconds(project.idle_time_seconds);
  }
}

export function __clearIdleTimeLimitCacheForTests() {
  cache.clear();
  currencyContext = null;
}
