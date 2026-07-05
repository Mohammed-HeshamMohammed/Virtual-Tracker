import crypto from "node:crypto";
import { COLLECTIONS } from "../../lib/firestore/collections.js";

/**
 * @typedef {Object} NotificationPayload
 * @property {string} recipient_id - The member ID who should receive this
 * @property {string} type - "task_assigned", "project_invite", "mention", etc.
 * @property {string} title
 * @property {string} message
 * @property {string} [link] - URL or path to navigate to when clicked
 */

/** Insert in-app notification row. */
export async function createNotification(db, payload) {
  if (!payload.recipient_id || !payload.title || !payload.message) {
    throw new Error("Missing required notification fields");
  }

  const id = crypto.randomUUID();
  const notification = {
    id,
    recipient_id: payload.recipient_id,
    type: payload.type || "system",
    title: payload.title,
    message: payload.message,
    link: payload.link || "",
    read: false,
    created_at: new Date(),
  };

  await db.collection(COLLECTIONS.notifications).doc(id).set(notification);
  return id;
}

/** Lists the most recent notifications for a member, newest first. */
export async function listNotificationsForMember(db, memberId, limit = 30) {
  const snapshot = await db
    .collection(COLLECTIONS.notifications)
    .where("recipient_id", "==", memberId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const createdAt = data.created_at;
    return {
      id: doc.id,
      recipient_id: data.recipient_id,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link || "",
      read: Boolean(data.read),
      created_at: typeof createdAt?.toDate === "function" ? createdAt.toDate().getTime() : createdAt,
    };
  });
}

/** Mark one notification read (checks recipient_id). */
export async function markNotificationAsRead(db, notificationId, memberId) {
  const ref = db.collection(COLLECTIONS.notifications).doc(notificationId);
  const snap = await ref.get();
  
  if (!snap.exists) return false;
  if (snap.data().recipient_id !== memberId) return false;

  await ref.update({ read: true });
  return true;
}

/** Mark all unread notifications read (batched). */
export async function markAllNotificationsAsRead(db, memberId) {
  const BATCH_SIZE = 500;

  while (true) {
    const snapshot = await db
      .collection(COLLECTIONS.notifications)
      .where("recipient_id", "==", memberId)
      .where("read", "==", false)
      .limit(BATCH_SIZE)
      .get();

    if (snapshot.empty) return;

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { read: true });
    });
    await batch.commit();

    if (snapshot.size < BATCH_SIZE) return;
  }
}
