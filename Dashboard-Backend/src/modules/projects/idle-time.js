// A project's idle time is the one point where the agent decides someone has
// walked away: until idle crosses it every second counts as active, and once
// it does the timer stops and the idle stretch is moved out of active. So it
// must never be able to eat the budget. With 160 hours on an 11-hour project,
// a member who walks away is paid for the whole budget and the timer never
// stops itself.
//
// The rule, for each member (the agent enforces idle one member at a time):
// idle time is at most half of whichever is smaller -
//   - the project budget, in that member's hours: hours budgets and any
//     per-person budget as entered; money budgets divided by the rate they
//     are charged at (the member's pay rate, or the client's bill rate);
//   - the member's own limit on the project, in hours the same way.
// When neither can be put in hours - no budget, or no rate to convert with -
// the limit is an hour. It is never under a minute.
//
// The web form checks the same rule (POST /api/projects/idle-time-limit), and
// idle-time-limit.service.js applies it again whenever idle time is handed to
// the agent - so an old value, an API client or a later budget cut can't get
// past it.

export const IDLE_TIME_MIN_SEC = 60;
/** The limit when there is nothing to put in hours. */
export const IDLE_TIME_FALLBACK_MAX_SEC = 60 * 60;
/** The share of the budget idle time may take. */
export const IDLE_TIME_BUDGET_SHARE = 0.5;
/** 7.5 minutes - the column default in ensure-lookup-schema.js. */
export const DEFAULT_IDLE_TIME_SEC = 450;
const PG_INTEGER_MAX = 2_147_483_647;

export const IDLE_TIME_MIN_MESSAGE = "Idle time must be at least 1 minute.";

/**
 * An error message, or null when `value` can be stored as a project's idle
 * time. The budget limit isn't checked here: the budget is saved alongside the
 * project, not before it, and the limit is applied when tracking reads it.
 */
export function validateIdleTimeSeconds(value) {
  const seconds = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return IDLE_TIME_MIN_MESSAGE;
  if (seconds < IDLE_TIME_MIN_SEC) return IDLE_TIME_MIN_MESSAGE;
  return null;
}

/** What gets stored: whole seconds, never under a minute. */
export function toStoredIdleTimeSeconds(value) {
  const seconds = Number(value);
  if (value === null || value === undefined || !Number.isFinite(seconds) || seconds <= 0) return DEFAULT_IDLE_TIME_SEC;
  return Math.min(PG_INTEGER_MAX, Math.max(IDLE_TIME_MIN_SEC, Math.floor(seconds)));
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}

function dayOf(value) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.slice(0, 10) || null;
}

/** Per-person budgets are entered as hours per person whatever their type. */
export function isHoursBudget(budget) {
  return String(budget?.type) === "Hours based" || budget?.scope === "per_person";
}

/** Money limits are the ones not measured in hours - the reading timer-limit.service.js uses. */
export function isHoursLimit(limit) {
  return String(limit?.type ?? "").toLowerCase().includes("hour");
}

/** A project_budgets row (type, scope, cost) in hours, at `rate` if it is money. */
export function budgetInHours(budget, rate) {
  const amount = positive(budget?.cost);
  if (!budget || !String(budget.type ?? "").trim() || amount === null) return { hours: null, basis: "no_budget" };
  if (isHoursBudget(budget)) return { hours: amount, basis: "hours_budget" };
  const hourly = positive(rate);
  return hourly === null ? { hours: null, basis: "no_rate" } : { hours: amount / hourly, basis: "rate_estimate" };
}

/** A project_member_limits row (type, cost, start_date) in hours, at `rate` if it is money. */
export function memberLimitInHours(limit, rate, today = new Date().toISOString().slice(0, 10)) {
  const amount = positive(limit?.cost);
  if (!limit || amount === null) return { hours: null, basis: "no_limit" };
  // Same as the timer's own limit: a limit that hasn't started yet doesn't apply.
  const start = dayOf(limit.start_date);
  if (start && start > today) return { hours: null, basis: "not_started" };
  if (isHoursLimit(limit)) return { hours: amount, basis: "member_limit_hours" };
  const hourly = positive(rate);
  return hourly === null ? { hours: null, basis: "no_rate" } : { hours: amount / hourly, basis: "member_limit_rate" };
}

function toLimitSeconds(hours) {
  return Math.min(PG_INTEGER_MAX, Math.max(IDLE_TIME_MIN_SEC, Math.floor(hours * 3600 * IDLE_TIME_BUDGET_SHARE)));
}

/**
 * The most idle time for one member - or for the project, without the member
 * arguments. `rate` converts a money budget; `memberLimitRate` a money member
 * limit. `source` says which of the two decided ("budget", "member_limit") or
 * that neither could ("fallback").
 */
export function idleTimeLimit({ budget = null, rate = null, memberLimit = null, memberLimitRate = null, today } = {}) {
  const fromBudget = budgetInHours(budget, rate);
  const fromLimit = memberLimitInHours(memberLimit, memberLimitRate, today);
  const details = {
    budgetHours: round2(fromBudget.hours),
    memberLimitHours: round2(fromLimit.hours),
    perPerson: fromBudget.hours !== null && budget?.scope === "per_person",
  };

  const candidates = [];
  if (fromBudget.hours !== null) candidates.push({ source: "budget", basis: fromBudget.basis, hours: fromBudget.hours });
  if (fromLimit.hours !== null) candidates.push({ source: "member_limit", basis: fromLimit.basis, hours: fromLimit.hours });

  if (candidates.length === 0) {
    const noRate = fromBudget.basis === "no_rate" || fromLimit.basis === "no_rate";
    return {
      maxSeconds: IDLE_TIME_FALLBACK_MAX_SEC,
      source: "fallback",
      basis: noRate ? "no_rate" : "no_budget",
      ...details,
    };
  }
  const tightest = candidates.reduce((a, b) => (b.hours < a.hours ? b : a));
  return { maxSeconds: toLimitSeconds(tightest.hours), source: tightest.source, basis: tightest.basis, ...details };
}

/**
 * A stored idle time brought within [1 minute, maxSeconds]. A missing or
 * unusable value becomes `fallback`, itself kept under the limit.
 */
export function clampIdleTimeSeconds(value, maxSeconds = IDLE_TIME_FALLBACK_MAX_SEC, fallback = DEFAULT_IDLE_TIME_SEC) {
  const ceiling = Math.max(IDLE_TIME_MIN_SEC, Number(maxSeconds) || IDLE_TIME_FALLBACK_MAX_SEC);
  const seconds = Number(value);
  const usable =
    value !== null && value !== undefined && Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : fallback;
  return Math.min(ceiling, Math.max(IDLE_TIME_MIN_SEC, usable));
}
