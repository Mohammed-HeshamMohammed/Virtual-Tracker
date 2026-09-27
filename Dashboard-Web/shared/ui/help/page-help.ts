// What each page is for, said once when the guided tour reaches the page. Keyed by the page
// ids in shared/ui/layout/config/nav-sections.ts; a test fails when a page is added there
// without one here.
//
// Self-contained on purpose (no imports), so it is tested straight from Node.

export const PAGE_HELP: Record<string, string> = {
  "command-center": "Command Center: your projects at a glance - time worked, budget, activity, project health and recent screenshots. Pick a project at the top right to focus on it.",
  general: "General: an overview of your time, tasks and activity across your projects.",
  notifications: "Notifications: every message and request sent to you. Open one to go to what it is about.",

  "timesheets-time-activity": "Time & Activity: how much time each member tracked and how active they were, by member and day.",
  "timesheets-view": "Task Approvals: time entries waiting for someone to review. Approve or reject them here.",
  "timesheets-submissions": "Timesheets: the timesheets people have submitted for approval, and where each one stands.",
  "timesheets-manual-requests": "Manual Time Requests: requests to add time that was not tracked. Review and approve or reject each one.",

  "activity-screenshots": "Screenshots: the screenshots captured while members track, by member and day. Open one to look at it larger.",
  "activity-apps": "Apps: which applications were used, by whom and for how long.",
  "activity-urls": "URLs: which websites were visited, by whom and for how long.",
  "activity-tools": "Tools: get My Virtual Tracker for your computer so time can be tracked.",
  "activity-removal-requests": "Removal Requests: requests to remove captured items such as screenshots. Review and decide each one.",

  "pm-overview": "Overview: your projects with their progress, budget and people at a glance.",
  "pm-projects": "Projects: create, edit and archive projects, and set their budget, members, idle time and break time.",
  "pm-tasks": "Tasks: every task, who it is assigned to and how it is going. Create and update tasks here.",
  "pm-clients": "Clients: the client companies you work for and the projects tied to them.",
  "calendar-timeoff": "Time off requests: leave that members have asked for. Approve or reject each request.",

  "reports-all": "All reports: every report you can open, grouped by topic.",
  "reports-custom": "Custom: a report you set up yourself.",
  "reports-time": "Time & activity: tracked time and activity level by person, project and period.",
  "reports-work-sessions": "Work sessions: each session someone tracked, with when it started and stopped and how long it lasted.",
  "reports-apps-urls": "Apps & URLs: the applications and websites used while tracking.",
  "reports-manual-edits": "Manual time edits: time that was added or changed by hand, and by whom.",
  "reports-timesheet-approvals": "Timesheet approvals: which timesheets were approved or rejected, and by whom.",
  "reports-expenses": "Expenses: the expenses that were recorded, by person and project.",
  "reports-work-breaks": "Work breaks: the breaks members took while tracking, and how long they lasted.",
  "reports-audit": "Audit log: a record of who changed what, and when.",
  "reports-amounts": "Amounts owed: what is owed to members for the time they worked.",
  "reports-payments": "Payments: the payments that were made, to whom and when.",
  "reports-weekly-limits": "Weekly limits: each member's weekly hour limit and how much of it they have used.",
  "reports-daily-limits": "Daily limits: each member's daily hour limit and how much of it they used each day.",
  "reports-project-budgets": "Project budgets: each project's budget and how much has been spent.",
  "reports-client-budgets": "Client budgets: each client's budget and how much has been spent.",
  "reports-time-off-balances": "Time off balances: how much leave each member has left.",
  "reports-time-off-transactions": "Time off transactions: leave that was booked, used or adjusted.",
  "reports-client-invoices": "Client invoices: the invoices sent to clients and their status.",
  "reports-team-invoices": "Team invoices: the invoices from team members and their status.",
  "reports-client-invoices-aging": "Client invoices aging: unpaid client invoices grouped by how overdue they are.",
  "reports-team-invoices-aging": "Team invoices aging: unpaid team invoices grouped by how overdue they are.",
  "reports-shift-attendance": "Shift attendance: who worked their scheduled shifts, and who was late or absent.",

  "people-members": "Members: everyone in your organization, with their role and status. Add, edit or deactivate members here.",
  "people-members-tree": "Members tree: who reports to whom, drawn as a tree.",
  "people-member-bans": "Banned members: members who are banned, and the tools to lift a ban.",
  "people-customer-accounts": "Customer accounts: the customer organizations that have their own space in this system.",
  "people-teams": "Teams: groups of members. Create teams and manage who is in them.",

  "financials-overview": "Overview: money in and out across payroll, invoices and expenses.",
  "financials-payroll": "Manage payroll: what each member is owed for the period.",
  "financials-create": "Create payments: pay members for their time.",
  "financials-records": "Payment records: the payments that have already been made.",
  "financials-invoices": "Invoices: create and track invoices.",
  "financials-expenses": "Expenses: record and review expenses.",

  "settings-all": "Settings: every setting for your organization, grouped by topic. Pick one to change it.",
  "settings-organization": "Organization: your organization's name, details and defaults.",
  "settings-members": "Members: settings for members, such as roles and invitations.",
  "settings-schedules": "Schedules: work schedules and shifts.",
  "settings-activity": "Activity & tracking: what the tracker collects and how idle time, screenshots and app and website classification behave.",
  "settings-integrations": "Integrations: connect other services to this system.",
  "settings-policies": "Policies: your organization's rules, such as time off and approvals.",
  "settings-compliance": "Compliance: what may be collected and why, how long it is kept, the monitoring notice members must accept, which devices are linked, and whether any data is being discarded.",
  "settings-enterprise-security": "Enterprise security: security controls for your organization, such as sign-in and access rules.",
  "settings-billing": "Billing: your subscription, invoices and payment details.",
  "settings-billing-plans": "Subscription plans: the plans available and what each includes.",

  profile: "Your profile: your name, contact details, photo and account settings.",
}

/** What a page is for, or "" when nothing has been written for it. */
export function pageHelp(pageId: string): string {
  return PAGE_HELP[pageId] ?? ""
}
