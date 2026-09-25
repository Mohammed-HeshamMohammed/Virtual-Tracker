import { query } from "../../lib/postgres/client.js";
import { createNotification } from "../notifications/service.js";
import { logSafeWarn } from "../../http/sanitize-error.js";
import { localDayFor } from "../../lib/time/timezone-utils.js";
import { getMemberTimezone } from "../reports/member-timezones.js";

export const NOTICE_KINDS = ["work_dropped", "session_reaped", "totals_mismatch"];

const COPY = {
  work_dropped: {
    // No minutes here on purpose: the tracker drops whole upload batches and
    // cannot say how much time each held, so a figure would be invented.
    title: "Some tracked activity could not be synced",
    body: () =>
      "Your tracker was offline long enough to fill its local store, and the oldest unsent activity was discarded. Check today's total and log any missing time.",
  },
  session_reaped: {
    title: "A timer was stopped for you",
    // The tracker resumes a session the server closed, carrying its own count
    // forward, so "check for missing time" would be wrong for the common case.
    body: () =>
      "Your tracker stopped reporting for several minutes while a timer was running, so the server closed the session. If the tracker was still running it picks up again on its own with the time it counted; if not, check today's total and log any missing time.",
  },
  totals_mismatch: {
    title: "Today's total does not match what your tracker recorded",
    body: (mins) =>
      `Your tracker recorded about ${mins} minute(s) more than the server stored. Nothing has been lost from your tracker, but the difference is worth raising.`,
  },
};

function minutes(seconds) {
  return Math.max(1, Math.round(Number(seconds || 0) / 60));
}

/**
 * The one way anything reports that a member's record changed without them
 * doing it. Returns the row, or null when there is nothing to record.
 *
 * Only the first occurrence of a kind on a day notifies; later ones add to the
 * same row. A member whose network is flapping gets one message, not fifty.
 */
export async function recordNotice({ memberId, kind, secondsAffected = 0, detail = "", day = null }) {
  if (!memberId || !NOTICE_KINDS.includes(kind)) return null;

  let localDay = day;
  if (!localDay) {
    try {
      localDay = localDayFor(new Date(), await getMemberTimezone(memberId));
    } catch {
      localDay = new Date().toISOString().slice(0, 10);
    }
  }

  const seconds = Math.max(0, Math.floor(Number(secondsAffected) || 0));
  const rows = await query(
    `INSERT INTO record_notices (member_id, kind, day, seconds_affected, detail)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (member_id, kind, day) DO UPDATE
       SET seconds_affected = record_notices.seconds_affected + EXCLUDED.seconds_affected,
           occurrences = record_notices.occurrences + 1,
           detail = COALESCE(NULLIF(EXCLUDED.detail, ''), record_notices.detail),
           updated_at = now()
     RETURNING id, member_id, kind, day, seconds_affected, occurrences, detail,
               (xmax = 0) AS inserted`,
    [memberId, kind, localDay, seconds, String(detail).slice(0, 300)],
  );
  const row = rows[0] ?? null;
  if (!row) return null;

  if (row.inserted) {
    try {
      const copy = COPY[kind];
      await createNotification(null, {
        recipient_id: memberId,
        type: "record_notice",
        title: copy.title,
        message: copy.body(minutes(seconds)),
        link: "/activity",
      });
    } catch (err) {
      // The row is the record of what happened; failing to tell the member
      // must not lose it, and the Owner view still shows it either way.
      logSafeWarn("[record-notices] could not notify the member", err);
    }
  }
  return row;
}

export async function listRecordNotices({ days = 7, memberId = null } = {}) {
  const span = Math.min(90, Math.max(1, Math.floor(Number(days) || 7)));
  return query(
    `SELECT n.id, n.member_id, n.kind, n.day, n.seconds_affected, n.occurrences, n.detail, n.updated_at,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), ''), m.display_name, m.work_email, '') AS member_name
       FROM record_notices n
       LEFT JOIN members m ON m.id = n.member_id
      WHERE n.day >= (now()::date - ($1::int - 1))
        AND ($2::uuid IS NULL OR n.member_id = $2)
      ORDER BY n.day DESC, n.updated_at DESC
      LIMIT 500`,
    [span, memberId],
  );
}

/**
 * The Owner's one answer to "is today's data complete?" - agents expected
 * against agents heard from, plus whatever went wrong with the record.
 */
export async function getDataHealth({ days = 7 } = {}) {
  const span = Math.min(90, Math.max(1, Math.floor(Number(days) || 7)));

  const [agents] = await query(
    `SELECT
       count(*) FILTER (WHERE m.status = 'active')::int AS active_members,
       count(*) FILTER (WHERE m.agent_last_opened_at >= now() - interval '24 hours')::int AS reported_today,
       count(*) FILTER (WHERE m.agent_update_blocked IS TRUE)::int AS update_blocked
     FROM members m
     LEFT JOIN roles r ON r.id = m.role_id
     WHERE m.status != 'banned' AND lower(COALESCE(r.name, '')) != 'owner'`,
  );

  const byKind = await query(
    `SELECT kind, count(*)::int AS notices, COALESCE(sum(seconds_affected), 0)::int AS seconds_affected,
            count(DISTINCT member_id)::int AS members
       FROM record_notices
      WHERE day >= (now()::date - ($1::int - 1))
      GROUP BY kind`,
    [span],
  );

  const [flags] = await query(
    `SELECT count(*)::int AS raised, count(DISTINCT member_id)::int AS members
       FROM activity_integrity_flags
      WHERE detected_at >= now() - ($1 || ' days')::interval`,
    [String(span)],
  );

  return {
    days: span,
    agents: {
      activeMembers: agents?.active_members ?? 0,
      reportedLast24h: agents?.reported_today ?? 0,
      updateBlocked: agents?.update_blocked ?? 0,
    },
    notices: Object.fromEntries(
      NOTICE_KINDS.map((kind) => {
        const row = byKind.find((r) => r.kind === kind);
        return [
          kind,
          {
            notices: row?.notices ?? 0,
            members: row?.members ?? 0,
            secondsAffected: row?.seconds_affected ?? 0,
          },
        ];
      }),
    ),
    integrityFlags: { raised: flags?.raised ?? 0, members: flags?.members ?? 0 },
  };
}
