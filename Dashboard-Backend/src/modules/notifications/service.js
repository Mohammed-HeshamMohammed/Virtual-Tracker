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

/**
 * Creates a notification in the database
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {NotificationPayload} payload
 * @returns {Promise<string>} The ID of the created notification
 */
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

/**
 * Marks a notification as read
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} notificationId
 * @param {string} memberId - Validates ownership
 * @returns {Promise<boolean>}
 */
export async function markNotificationAsRead(db, notificationId, memberId) {
  const ref = db.collection(COLLECTIONS.notifications).doc(notificationId);
  const snap = await ref.get();
  
  if (!snap.exists) return false;
  if (snap.data().recipient_id !== memberId) return false;

  await ref.update({ read: true });
  return true;
}

/**
 * Marks all notifications as read for a user (processes every unread notification).
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {string} memberId
 */
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
