// Everything the desktop agent shows that isn't about the timer itself,
// resolved per-role in one round trip: the member's own standing (time off,
// timesheet, earnings), and - only for whoever is entitled to it - their
// team's live status, a pending-approvals count, and an org-wide pulse.
//
// One endpoint rather than four, because the agent polls this on a timer and
// four independently-polled endpoints would be four times the traffic for a
// panel that renders as a single unit. Each section is null when the viewer
// isn't entitled to it, so the agent renders whatever came back and needs no
// role logic of its own (and can't be tricked into showing a section by a
// spoofed local role - entitlement is decided here, server-side).
import { query } from "../../lib/postgres/client.js";
import { isManagementRole } from "../../http/auth-context.js";
import { isOrgProjectAdminRole } from "../../http/project-access.js";
import { canViewCompensation } from "../../http/field-policy.js";
import { getTeamIdsLedByMember } from "../../http/team-edit-access.js";
import { getVisibleMemberIds } from "../member-relationships/service.js";
import { currentDayRange } from "../tasks/timer-limit.service.js";
import { getTimeOffBalanceRowsPg } from "../../lib/postgres/time-off-postgres.service.js";
import { sumMemberActiveIdleSeconds } from "../../lib/postgres/activity-events-postgres.service.js";

/** First day of the calendar month containing `dayKey` ('YYYY-MM-DD'). */
function monthStart(dayKey) {
  return `${dayKey.slice(0, 7)}-01`;
}

/** The one display-name expression every query below uses, so a member reads
 *  the same in the team list as everywhere else in the product. */
const MEMBER_NAME_SQL = `COALESCE(NULLIF(TRIM(m.display_name), ''), NULLIF(TRIM(CONCAT(m.first_name, ' ', m.last_name)), ''), 'Unknown')`;

/**
 * The viewer's own standing: time-off balances, their latest timesheet, and
 * what they've earned this week/month. Always present - every role that can
 * sign in to the agent gets this, including a client tracking on an opted-in
 * project.
 * @param {{ memberId: string, roleName: string }} viewer
 * @param {string} todayDay
 * @param {string} weekStartDay
 */
async function buildSelfSection(viewer, todayDay, weekStartDay) {
  const [timeOffRows, timesheetRows, rateRows, weekActivity, monthActivity] = await Promise.all([
    getTimeOffBalanceRowsPg({ memberIds: [viewer.memberId], asOf: todayDay }),
    query(
      `SELECT period_start, period_end, status, total_hours, submitted_at, approved_at
       FROM timesheets WHERE member_id = $1
       ORDER BY period_start DESC LIMIT 1`,
      [viewer.memberId],
    ),
    query("SELECT rate, currency FROM pay_rates WHERE member_id = $1 LIMIT 1", [viewer.memberId]),
    sumMemberActiveIdleSeconds(viewer.memberId, { fromDay: weekStartDay, toDay: todayDay }),
    sumMemberActiveIdleSeconds(viewer.memberId, { fromDay: monthStart(todayDay), toDay: todayDay }),
  ]);

  const latest = timesheetRows[0] ?? null;
  // canViewCompensation is always true for a viewer reading their own row -
  // called anyway rather than assumed, so this stays correct if that rule
  // ever tightens.
  const rate = canViewCompensation(viewer, viewer.memberId) ? Number(rateRows[0]?.rate ?? 0) : 0;

  return {
    timeOff: timeOffRows.map((row) => ({
      // policyId is what a time-off request is filed against, so it has to
      // travel with the balance the agent shows - otherwise the request
      // dialog would have to re-fetch the policy list just to name one.
      policyId: row.policyId,
      policyName: row.policyName,
      balanceDays: row.balanceDays,
      entitlementDays: row.entitlementDays,
    })),
    timesheet: latest
      ? {
          periodStart: String(latest.period_start).slice(0, 10),
          periodEnd: String(latest.period_end).slice(0, 10),
          status: String(latest.status ?? "draft"),
          totalHours: latest.total_hours == null ? 0 : Number(latest.total_hours),
        }
      : null,
    // 0 for a member with no pay rate configured - the agent hides the card
    // rather than showing an authoritative-looking $0.00.
    earnings: {
      currency: String(rateRows[0]?.currency ?? "USD"),
      hourlyRate: rate,
      weekAmount: Math.round((weekActivity.activeSeconds / 3600) * rate * 100) / 100,
      monthAmount: Math.round((monthActivity.activeSeconds / 3600) * rate * 100) / 100,
    },
  };
}

/**
 * The teams this viewer actually leads, and where each of their members
 * stands today. Entitlement is the `is_lead` flag on team_members, not a role
 * name - a Team Lead who leads nothing gets nothing, and a Manager flagged as
 * a lead gets the panel, which is what the flag already means everywhere else
 * (see getTeamIdsLedByMember).
 * @param {string[]} teamIds
 * @param {string} todayDay
 */
async function buildTeamSection(teamIds, todayDay) {
  const rows = await query(
    `SELECT m.id AS member_id,
            ${MEMBER_NAME_SQL} AS name,
            EXISTS (
              SELECT 1 FROM activity_sessions s
              WHERE s.member_id = m.id AND s.ended_at IS NULL AND s.status = 'active'
            ) AS tracking_now,
            EXISTS (
              SELECT 1 FROM activity_sessions s
              WHERE s.member_id = m.id AND s.ended_at IS NULL AND s.status <> 'active'
            ) AS on_break,
            COALESCE((
              SELECT SUM(s.active_seconds) FROM activity_sessions s
              WHERE s.member_id = m.id
                AND (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date = $2::date
            ), 0) AS active_seconds_today
     FROM members m
     WHERE m.id IN (SELECT member_id FROM team_members WHERE team_id = ANY($1::uuid[]))
       AND m.status <> 'banned'
     ORDER BY name ASC
     LIMIT 200`,
    [teamIds, todayDay],
  );

  const members = rows.map((r) => ({
    memberId: String(r.member_id),
    name: String(r.name),
    trackingNow: r.tracking_now === true,
    onBreak: r.on_break === true,
    activeSecondsToday: Math.max(0, Math.floor(Number(r.active_seconds_today) || 0)),
  }));

  return {
    teamCount: teamIds.length,
    members,
    trackingNowCount: members.filter((m) => m.trackingNow).length,
    // "Hasn't started today" is the number a lead actually chases - a member
    // with no tracked seconds at all today, not merely one who is idle right
    // now (that member already worked and stepped away).
    notStartedCount: members.filter((m) => m.activeSecondsToday === 0 && !m.trackingNow).length,
    totalActiveSecondsToday: members.reduce((sum, m) => sum + m.activeSecondsToday, 0),
  };
}

/**
 * How many timesheets are sitting in 'submitted' waiting on this viewer,
 * scoped to the members they can actually see. Management roles only.
 * @param {string[] | null} visibleMemberIds null = every member
 */
async function buildApprovalsSection(visibleMemberIds) {
  const rows = await query(
    `SELECT COUNT(*)::int AS pending
     FROM timesheets
     WHERE status = 'submitted'
       AND ($1::uuid[] IS NULL OR member_id = ANY($1::uuid[]))`,
    [visibleMemberIds],
  );
  return { pendingCount: Number(rows[0]?.pending ?? 0) };
}

/**
 * Org-wide today: total tracked time, how many people are tracking right
 * now, how many worked at all. Org-admin tier only (Super Manager and up) -
 * this is deliberately three numbers, not a second Command Center.
 * @param {string} todayDay
 */
async function buildPulseSection(todayDay) {
  const rows = await query(
    `SELECT COALESCE(SUM(s.active_seconds), 0) AS active_seconds,
            COUNT(DISTINCT s.member_id) FILTER (
              WHERE s.ended_at IS NULL AND s.status = 'active'
            ) AS tracking_now,
            COUNT(DISTINCT s.member_id) AS members_worked
     FROM activity_sessions s
     LEFT JOIN members m ON m.id = s.member_id
     WHERE (s.started_at AT TIME ZONE COALESCE(NULLIF(m.timezone, ''), 'UTC'))::date = $1::date`,
    [todayDay],
  );
  const row = rows[0] ?? {};
  return {
    totalActiveSecondsToday: Math.max(0, Math.floor(Number(row.active_seconds) || 0)),
    trackingNowCount: Number(row.tracking_now ?? 0),
    membersWorkedTodayCount: Number(row.members_worked ?? 0),
  };
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {{ memberId: string, roleName: string }} viewer
 */
export async function buildAgentWorkspace(db, viewer) {
  const { todayDay, weekStartDay } = currentDayRange();

  const ledTeamIds = [...(await getTeamIdsLedByMember(db, viewer.memberId))];
  const isManagement = isManagementRole(viewer.roleName);
  const isOrgAdmin = isOrgProjectAdminRole(viewer.roleName);

  const [self, team, approvals, pulse] = await Promise.all([
    buildSelfSection(viewer, todayDay, weekStartDay),
    ledTeamIds.length > 0 ? buildTeamSection(ledTeamIds, todayDay) : null,
    isManagement
      ? getVisibleMemberIds(db, viewer.memberId, viewer.roleName).then(buildApprovalsSection)
      : null,
    isOrgAdmin ? buildPulseSection(todayDay) : null,
  ]);

  return {
    self,
    team,
    approvals,
    pulse,
    // Decided here rather than from the agent's own copy of the role, for
    // the same reason the sections above are: the desktop app renders what
    // it is told, so a spoofed local role must not be able to reveal a
    // control. Manual time entry is Manager-and-above only (isManagementRole
    // - the same helper Dashboard-Web's "Add time for someone" already gates
    // on, so the two surfaces agree).
    capabilities: { canLogManualTime: isManagement },
  };
}
