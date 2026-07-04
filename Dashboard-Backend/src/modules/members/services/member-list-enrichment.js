/** Batched member-list enrichment — avoids full-collection scans on pay_rates, limits, relations. */

const MEMBER_ID_IN_CHUNK = 30;

/**
 * @param {number | string | null | undefined} rate
 * @param {string} [payPeriod]
 */
export function formatMemberPaymentDisplay(rate, payPeriod = "None") {
  const numericRate = typeof rate === "number" ? rate : Number(rate);
  if (!Number.isFinite(numericRate) || numericRate <= 0) return "";
  const period = typeof payPeriod === "string" ? payPeriod.trim() : "";
  if (!period || period === "None") return `$${numericRate}/hr`;
  return `$${numericRate} (${period})`;
}

/**
 * @param {number | string | null | undefined} weeklyLimit
 */
export function formatMemberLimitsDisplay(weeklyLimit) {
  if (weeklyLimit == null || weeklyLimit === "") return "No limit";
  const numeric =
    typeof weeklyLimit === "number"
      ? weeklyLimit
      : Number(String(weeklyLimit).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return "No limit";
  return `${numeric} hrs/wk`;
}

/**
 * @param {string[]} memberIds
 * @param {number} [chunkSize]
 */
export function chunkMemberIds(memberIds, chunkSize = MEMBER_ID_IN_CHUNK) {
  const unique = [...new Set(memberIds.filter((id) => typeof id === "string" && id))];
  const chunks = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} collection
 * @param {string[]} memberIds
 * @param {(query: import("firebase-admin/firestore").Query) => import("firebase-admin/firestore").Query} [applyFilter]
 */
async function fetchDocsByMemberIdChunks(db, collection, memberIds, applyFilter) {
  const chunks = chunkMemberIds(memberIds);
  if (!chunks.length) return [];

  const docs = [];
  for (const chunk of chunks) {
    let query = db.collection(collection).where("member_id", "in", chunk);
    if (applyFilter) query = applyFilter(query);
    const snap = await query.get();
    docs.push(...snap.docs);
  }
  return docs;
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} memberIds
 */
export async function fetchPayRatesForMembers(db, memberIds) {
  return fetchDocsByMemberIdChunks(db, "pay_rates", memberIds);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} memberIds
 */
export async function fetchWeeklyLimitsForMembers(db, memberIds) {
  const unique = [...new Set(memberIds.filter((id) => typeof id === "string" && id))];
  if (!unique.length) return [];
  const refs = unique.map((id) => db.collection("limits").doc(id));
  return db.getAll(...refs);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} memberIds
 */
export async function fetchMemberRolesForMembers(db, memberIds) {
  return fetchDocsByMemberIdChunks(db, "member_roles", memberIds);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string[]} memberIds
 */
export async function fetchMemberRelationSnaps(db, memberIds) {
  const ids = memberIds.filter((id) => typeof id === "string" && id);
  if (!ids.length) {
    return { teamMembersSnap: { docs: [] }, teamsSnap: { docs: [] }, projectMembersSnap: { docs: [] } };
  }

  const [teamMemberDocs, projectMemberDocs] = await Promise.all([
    fetchDocsByMemberIdChunks(db, "team_members", ids),
    fetchDocsByMemberIdChunks(db, "project_members", ids),
  ]);

  const teamIds = new Set();
  for (const doc of teamMemberDocs) {
    const teamId = typeof doc.data()?.team_id === "string" ? doc.data().team_id : "";
    if (teamId) teamIds.add(teamId);
  }

  let teamDocs = [];
  if (teamIds.size > 0) {
    const refs = [...teamIds].map((id) => db.collection("teams").doc(id));
    teamDocs = await db.getAll(...refs);
  }

  return {
    teamMembersSnap: { docs: teamMemberDocs },
    teamsSnap: { docs: teamDocs },
    projectMembersSnap: { docs: projectMemberDocs },
  };
}

/**
 * @param {Array<{ id: string } & Record<string, unknown>>} members
 * @param {import("firebase-admin/firestore").QueryDocumentSnapshot[]} payDocs
 * @param {import("firebase-admin/firestore").QueryDocumentSnapshot[]} limitDocs
 */
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

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {Array<{ id: string } & Record<string, unknown>>} members
 */
export async function enrichMembersWithPayAndLimits(db, members) {
  if (!members.length) return members;
  const memberIds = members.map((m) => m.id);
  const [payDocs, limitDocs] = await Promise.all([
    fetchPayRatesForMembers(db, memberIds),
    fetchWeeklyLimitsForMembers(db, memberIds),
  ]);
  return enrichMembersWithPayAndLimitsFromDocs(members, payDocs, limitDocs);
}
