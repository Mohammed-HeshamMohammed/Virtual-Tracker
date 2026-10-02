
import { getPayRatesBatchPg } from "../../../lib/postgres/member-data-postgres.service.js";
import { query as pgQuery } from "../../../lib/postgres/client.js";
import { fetchWeeklyLimitsForMembers } from "../../../lib/postgres/member-data-store.js";

export { fetchWeeklyLimitsForMembers };

export function formatMemberPaymentDisplay(rate, payPeriod = "None") {
  const numericRate = typeof rate === "number" ? rate : Number(rate);
  if (!Number.isFinite(numericRate) || numericRate <= 0) return "";
  const period = typeof payPeriod === "string" ? payPeriod.trim() : "";
  if (!period || period === "None") return `$${numericRate}/hr`;
  return `$${numericRate} (${period})`;
}

export function formatMemberLimitsDisplay(weeklyLimit) {
  if (weeklyLimit == null || weeklyLimit === "") return "No limit";
  const numeric =
    typeof weeklyLimit === "number"
      ? weeklyLimit
      : Number(String(weeklyLimit).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return "No limit";
  return `${numeric} hrs/wk`;
}

export async function fetchPayRatesForMembers(_db, memberIds) {
  const rows = await getPayRatesBatchPg(memberIds);
  return rows.map((row) => ({ data: () => row }));
}

export async function fetchMemberRelationSnaps(db, memberIds) {
  const ids = memberIds.filter((id) => typeof id === "string" && id);
  if (!ids.length) {
    return { teamMembersSnap: { docs: [] }, teamsSnap: { docs: [] }, projectMembersSnap: { docs: [] } };
  }

  try {
    const [teamMemberRows, projectMemberRows] = await Promise.all([
      pgQuery("SELECT id, team_id, member_id, is_lead FROM team_members WHERE member_id = ANY($1)", [ids]),
      pgQuery("SELECT id, project_id, member_id, project_role FROM project_members WHERE member_id = ANY($1)", [ids]),
    ]);

    const teamIds = [...new Set(teamMemberRows.map((r) => r.team_id).filter(Boolean))];
    let teamRows = [];
    if (teamIds.length > 0) {
      teamRows = await pgQuery("SELECT id, name FROM teams WHERE id = ANY($1)", [teamIds]);
    }

    const teamMemberDocs = teamMemberRows.map((r) => ({ id: r.id, data: () => r }));
    const projectMemberDocs = projectMemberRows.map((r) => ({ id: r.id, data: () => r }));
    const teamDocs = teamRows.map((r) => ({ id: r.id, exists: true, data: () => r }));

    return {
      teamMembersSnap: { docs: teamMemberDocs },
      teamsSnap: { docs: teamDocs },
      projectMembersSnap: { docs: projectMemberDocs },
    };
  } catch (err) {
    return { teamMembersSnap: { docs: [] }, teamsSnap: { docs: [] }, projectMembersSnap: { docs: [] } };
  }
}

export function enrichMembersWithPayAndLimitsFromDocs(members, payDocs, limitDocs) {
  if (!members.length) return members;
  const memberIdSet = new Set(members.map((m) => m.id));
  const payByMember = new Map();
  for (const doc of payDocs) {
    const data = doc.data() || {};
    const memberId = typeof data.member_id === "string" ? data.member_id : "";
    if (memberIdSet.has(memberId)) {
      payByMember.set(memberId, {
        rate: data.rate ?? 0,
        pay_period: typeof data.pay_period === "string" ? data.pay_period : "None",
      });
    }
  }
  const weeklyByMember = new Map();
  for (const doc of limitDocs) {
    if (!doc.exists) continue;
    const memberId = doc.id;
    if (memberIdSet.has(memberId)) weeklyByMember.set(memberId, doc.data()?.weekly);
  }
  return members.map((member) => {
    const pay = payByMember.get(member.id);
    const payRate = pay?.rate ?? 0;
    const payPeriod = pay?.pay_period ?? "None";
    const weeklyLimit = weeklyByMember.get(member.id) ?? null;
    return {
      ...member,
      pay_rate: payRate,
      pay_period: payPeriod,
      weekly_limit: weeklyLimit,
      payment: formatMemberPaymentDisplay(payRate, payPeriod),
      limits: formatMemberLimitsDisplay(weeklyLimit),
    };
  });
}

export async function enrichMembersWithPayAndLimits(db, members) {
  if (!members.length) return members;
  const memberIds = members.map((m) => m.id);
  const [payDocs, limitDocs] = await Promise.all([
    fetchPayRatesForMembers(db, memberIds),
    fetchWeeklyLimitsForMembers(db, memberIds),
  ]);
  return enrichMembersWithPayAndLimitsFromDocs(members, payDocs, limitDocs);
}

/**
 * The Postgres members list reads v_members_enriched, whose `projects` and `teams` are JSON
 * arrays of {id, name}; every other path (and the web table) speaks counts plus `project_ids` /
 * `team_names`. Left as arrays, the Projects column read 0 for everyone, the project filter
 * matched nobody, and team names came out empty. Flatten them to the shared shape.
 */
export function flattenViewRelations(member) {
  const projects = Array.isArray(member.projects) ? member.projects : null;
  const teams = Array.isArray(member.teams) ? member.teams : null;
  if (!projects && !teams) return member;
  const idsOf = (list) => [...new Set(list.map((item) => (typeof item === "string" ? item : item?.id)).filter((id) => typeof id === "string" && id))];
  const namesOf = (list) => [...new Set(list.map((item) => (typeof item === "string" ? item : item?.name)).filter((name) => typeof name === "string" && name))];
  return {
    ...member,
    ...(projects ? { projects: idsOf(projects).length, project_ids: idsOf(projects) } : {}),
    ...(teams ? { teams: idsOf(teams).length, team_names: namesOf(teams) } : {}),
  };
}
