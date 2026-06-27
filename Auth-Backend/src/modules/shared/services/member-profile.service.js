import crypto from "node:crypto";

async function upsertSingleByMemberId(db, collection, memberId, payload) {
  const snap = await db.collection(collection).where("member_id", "==", memberId).get();
  if (!snap.empty) {
    const batch = db.batch();
    for (const doc of snap.docs) batch.update(doc.ref, payload);
    await batch.commit();
    return snap.docs[0].id;
  }
  const id = crypto.randomUUID();
  await db.collection(collection).doc(id).set({ id, member_id: memberId, ...payload });
  return id;
}

export async function upsertMemberPayRate(db, memberId, rate, updatedBy = "") {
  const actor = updatedBy || "system";
  const now = new Date();
  await upsertSingleByMemberId(db, "pay_rates", memberId, {
    type: "hourly",
    rate,
    currency: "USD",
    pay_period: "None",
    effective_date: now,
    status: "active",
    updated_by: actor,
    updated_at: now,
  });
}

export async function deleteMemberProfileData(db, memberId) {
  const collections = [
    "employment",
    "pay_rates",
    "time_settings",
    "limits",
    "team_members",
    "project_members",
    "member_onboarding",
  ];
  for (const collection of collections) {
    const snap = await db.collection(collection).where("member_id", "==", memberId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}
