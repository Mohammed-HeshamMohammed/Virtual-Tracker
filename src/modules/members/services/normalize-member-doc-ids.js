import crypto from "node:crypto";
import { rekeyMemberDataMemberIdPg } from "../../../lib/postgres/member-data-postgres.service.js";
import { getSystemMetaDoc, setSystemMetaDoc } from "../../../lib/postgres/member-data-store.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_KEY = "member_document_ids";

/** Collections/fields that store a reference to members.id (Firestore only). */
const MEMBER_REFERENCES = [
  { collection: "clients", fields: ["member_id"] },
  { collection: "project_members", fields: ["member_id"] },
  { collection: "team_members", fields: ["member_id"] },
  { collection: "member_relationships", fields: ["parent_member_id", "child_member_id"] },
  { collection: "client_projects", fields: ["assigned_by"] },
  { collection: "members_field_data", fields: ["memberDocId"] },
];

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * Re-key legacy auth_* member ids to UUIDs. Skips rows that already use UUIDs.
 * @param {import("firebase-admin/firestore").Firestore} db
 */
export async function normalizeLegacyMemberDocumentIds(db) {
  const meta = await getSystemMetaDoc(db, META_KEY);
  if (meta?.complete === true) {
    const snap = await db.collection("members").limit(500).get();
    const legacyLeft = snap.docs.some((d) => !isUuid(d.id));
    if (!legacyLeft) return { migrated: 0, skipped: true };
  }

  const snap = await db.collection("members").limit(500).get();
  let migrated = 0;
  const idMap = new Map();

  for (const doc of snap.docs) {
    if (isUuid(doc.id)) continue;
    idMap.set(doc.id, crypto.randomUUID());
  }

  if (idMap.size === 0) {
    await setSystemMetaDoc(db, META_KEY, { complete: true, checked_at: new Date().toISOString() });
    return { migrated: 0, skipped: true };
  }

  for (const [oldId, newId] of idMap.entries()) {
    const oldRef = db.collection("members").doc(oldId);
    const oldSnap = await oldRef.get();
    if (!oldSnap.exists) continue;

    const data = oldSnap.data() || {};
    let batch = db.batch();
    let ops = 0;

    const flush = async () => {
      if (ops > 0) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };

    batch.set(db.collection("members").doc(newId), {
      ...data,
      id: newId,
      legacy_member_doc_id: oldId,
      updated_at: new Date(),
      updated_by: "member-id-normalize",
    });
    ops += 1;
    batch.delete(oldRef);
    ops += 1;

    for (const { collection, fields } of MEMBER_REFERENCES) {
      for (const field of fields) {
        const refs = await db.collection(collection).where(field, "==", oldId).get();
        for (const row of refs.docs) {
          batch.update(row.ref, { [field]: newId });
          ops += 1;
          if (ops >= 450) await flush();
        }
      }
    }

    const treeOld = await db.collection("member_tree").doc(oldId).get();
    if (treeOld.exists) {
      const treeData = treeOld.data() || {};
      batch.set(db.collection("member_tree").doc(newId), { ...treeData, id: newId });
      batch.delete(treeOld.ref);
      ops += 2;
    }

    await flush();
    await rekeyMemberDataMemberIdPg(oldId, newId);
    migrated += 1;
  }

  await setSystemMetaDoc(db, META_KEY, {
    complete: true,
    migrated_count: migrated,
    completed_at: new Date().toISOString(),
  });

  return { migrated, idMap: Object.fromEntries(idMap) };
}
