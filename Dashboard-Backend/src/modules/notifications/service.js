import { query } from "../../lib/postgres/client.js";
import { publishChange } from "../realtime/change-bus.js";


function normalizeRow(row) {
  const createdAt = row.created_at;
  return {
    id: row.id,
    recipient_id: row.recipient_id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link || "",
    read: Boolean(row.read),
    created_at: createdAt instanceof Date ? createdAt.getTime() : createdAt,
  };
}

export async function createNotification(_db, payload) {
  if (!payload.recipient_id || !payload.title || !payload.message) {
    throw new Error("Missing required notification fields");
  }

  const rows = await query(
    `INSERT INTO notifications (recipient_id, type, title, message, link)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [payload.recipient_id, payload.type || "system", payload.title, payload.message, payload.link || ""],
  );
  void publishChange("notifications", rows[0].id, "created");
  return rows[0].id;
}

export async function listNotificationsForMember(_db, memberId, limit = 30) {
  const rows = await query(
    `SELECT id, recipient_id, type, title, message, link, read, created_at
     FROM notifications
     WHERE recipient_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [memberId, limit],
  );
  return rows.map(normalizeRow);
}

export async function markNotificationAsRead(_db, notificationId, memberId) {
  const rows = await query(
    `UPDATE notifications SET read = true WHERE id = $1 AND recipient_id = $2 RETURNING id`,
    [notificationId, memberId],
  );
  return rows.length > 0;
}

export async function markAllNotificationsAsRead(_db, memberId) {
  await query(`UPDATE notifications SET read = true WHERE recipient_id = $1 AND read = false`, [memberId]);
}
