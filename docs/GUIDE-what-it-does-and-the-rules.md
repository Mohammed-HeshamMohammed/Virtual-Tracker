# My Virtual Tracker: What It Does and the Rules It Follows

A plain-language guide to the whole product: what each part does, who can do what, and every
limit and rule the system enforces. It is written for owners, managers and members, not for
engineers. It was checked against the code on 2026-11-26.

---

## 1. The product in one minute

My Virtual Tracker has three parts:

| Part | Who uses it | What it is for |
|---|---|---|
| **The desktop tracker** | Members (employees, interns, team leads and so on) | A small app on their computer. They start a timer on a project or task, and while it runs the app records their work time, which apps and websites they use, how active they are, and screenshots. |
| **The dashboard** (app.myvirtualtracker.com) | Owners, managers, and members looking at their own work | The website where the organization is run: people, teams, projects, tasks, clients, time, screenshots, reports, invoices, settings. |
| **The public website** (myvirtualtracker.com) | Visitors | Explains the product and has a contact form. |

Everything the tracker records goes to the organization's own account. Members can always see
what was recorded about them.

---

## 2. Roles: who is who

Every person has one role. Roles are ranked, highest first:

| Rank | Role | In short |
|---|---|---|
| 1 | **Owner** | Runs the whole organization. There is one, and nobody can make someone else Owner. |
| 2 | **Super Admin** | Runs the organization alongside the Owner. |
| 3 | **Admin** | Manages people, projects and settings. |
| 4 | **Super Manager** | Manages managers and their people. |
| 5 | **Manager** | Manages their own people and projects. |
| 6 | **Team Lead** | Leads a team; tracks time like an employee. |
| 7 | **Employee** | Tracks their own time and sees their own work. |
| 8 | **Intern** | Like an employee. |
| 9 | **Client** | A customer who can see the work done for them. |
| 10 | **Viewer** | Can look, but does not track time. |

There are also two special roles, **Enterprise Super Manager** and **Enterprise Manager**. They
belong to customer organizations (section 7) and are never handed out from a normal role menu.

### Role rules

- **Adding people:** only the Owner, Super Admins, Admins, Super Managers and Managers (and the
  enterprise roles inside their own organization) can add members.
- **Giving roles:** you can only give a role **below your own**. The Owner can give anything up to
  Super Admin. Nobody can give the Owner role.
- **Leadership** (Owner, Super Admin, Admin) sees the whole organization. Everyone else sees
  only what their position in the reporting tree allows: their own work, their people's work,
  and the projects they belong to.
- **Employees and interns** get a personal view of the home screen: their own day, not the
  company's.
- **Closing an account:** a Viewer can delete their own account. For everyone else, closing an
  account goes through a request that an Owner, Super Admin or Admin approves.
- **Project management settings** can only be changed by Admins and Super Managers (and above).
- **Editing a team** is limited to the Owner and that team's leads.
- **Clients** do not request time off.

---

## 3. The desktop tracker

### Getting started

- **Installing and signing in.** The member installs the app and signs in. The app links itself
  to their account; each computer is registered as a device. If the link is lost the app asks
  them to sign in again.
- **Monitoring notice.** If the organization requires it, the member must read and confirm a
  notice that says what is collected and why **before** they can start tracking.
- **Starts with the computer.** The app starts when Windows starts and lives in the system tray.
- **Administrator permission.** On Windows the app asks for administrator permission when it
  starts.
- **Updates.** The app updates itself. Every update is checked against the company's signature
  before it is installed, so a fake update is refused.
- **Computers it runs on.** Windows 10 and 11 is the main version. A separate build runs on
  Windows 7, 8 and 8.1. Mac and Linux builds are also produced.

### Tracking time

- **Start / stop.** The member picks a project (and a task, if the project works with tasks)
  and starts the timer. Stopping can include a short note about what was done.
- **Pause.** "Still at my desk but not working." The timer stops. Apps and websites keep being
  recorded, but screenshots stop. Only the member can end a pause.
- **Break.** "Away from the computer." The timer stops and **nothing** is recorded. The break
  ends by itself when the project's break time is up (10 minutes unless the project says
  otherwise), so nobody is left on break by accident.
- **Private break.** The member chooses how long and gives a reason. The timer pauses and all
  recording stops. Their manager sees that they took a break and the reason.
- **Computer goes to sleep.** The timer pauses on its own and resumes when the computer wakes.
- **Working past midnight.** Time belongs to the day it was worked. A pause that runs past
  midnight is closed and continued on the new day, so the next day's time is not put on the
  day before.
- **Log time by hand.** The member can add time they worked without the timer (subject to the
  limits in section 5).
- **Create tasks, request time off.** Both can be done from the tracker.
- **Mini mode.** A small floating version of the timer.

### What is recorded while the timer runs

- **Activity level.** Every minute the app measures how much the keyboard and mouse were used and
  turns it into a score. It only counts *how much*, never *what* was typed.
- **Automatic input is spotted.** Mouse jigglers and other fake-input tools are detected and the
  activity is flagged.
- **Apps and websites.** Every 15 seconds the app notes which program is in front and, for
  browsers, which website.
- **Screenshots.** At a random moment every 1.5 to 3.5 minutes (the first one about 5 seconds
  after starting), reduced to at most 1280 pixels wide.
- **Blurring.** Screenshots can be blurred at three strengths (standard, strong, maximum), so
  text cannot be read.
- **Excluded apps and sites.** The organization can list apps and websites that are never
  recorded (a banking site, a medical portal).
- **Things the organization switched off.** If screenshots, app tracking or website tracking
  is turned off for the organization, that data is not kept, even if an old app sends it.

### Idle time

If nobody touches the keyboard or mouse for longer than the project's **idle time**, the timer
stops by itself. The time since the last real input is taken out of work time and counted as idle.
See section 5 for the limits on idle time.

### When the internet drops

The app keeps working offline and saves what it records on the computer. It sends everything
when the connection returns. It keeps up to 2,000 saved batches or 200 MB, whichever comes
first. Beyond that, the oldest are dropped.

### Messages from the Owner

- **Messages.** The Owner can send a member a message. It appears in the tracker and as a
  Windows notification. The member can reply.
- **Buzz.** The Owner or a Super Admin can "buzz" someone: a small pop-up or a joke "blue
  screen" with a short message. See section 5 for the rules.

---

## 4. The dashboard

### Home

- **Command Center:** the main overview of the organization (or, for employees, of their own work).
- **Notifications:** everything that needs attention, with read and unread.

### Timesheets

- **Time & Activity:** who worked how long, on what, and how active they were.
- **Task Approvals:** review time logged on tasks.
- **Timesheets:** members submit their time for a pay period; managers approve it.
- **Manual Time Requests:** time added by hand that needs approval.

### Activity

- **Screenshots:** browse screenshots by person and day. People with the right role can delete a
  screenshot or correct its activity.
- **Apps** and **URLs:** which programs and websites were used, and for how long.
- **Tools:** the tools people use, grouped.
- **Removal Requests:** a member who finds a screenshot that caught something private (a
  password, a medical letter) can ask for it to be removed. The request is reviewed here.

### Project Management

- **Overview, Projects, Tasks, Clients.**
- **Projects:** budgets, members, per-member hour limits, idle time and break time, time zone,
  and whether time must be tracked against tasks.
- **Tasks:** board, list or calendar views. Drag to reorder, assign people, and review
  assignments.
- **Clients:** budgets by hours, a fixed amount, or a monthly retainer, plus bill rates and
  invoicing settings.
- **Time off requests:** members ask, managers decide.

### Reports

All reports can be filtered, and several can be exported, emailed on a schedule, or saved:

- **General:** time & activity, work sessions, apps & URLs, manual time edits, timesheet
  approvals, expenses, work breaks, audit log.
- **Payment:** amounts owed, payments.
- **Budgets and limits:** weekly limits, daily limits, project budgets, client budgets.
- **Time off:** balances and transactions.
- **Invoices:** client and team invoices, and how overdue they are.
- **Schedule:** shift attendance.
- **Custom reports.**
- **Weekly team reports** are created automatically.

### People

- **Members:** add, edit, invite (one person or many), change roles, ban, and move people between
  managers.
- **Members tree:** the reporting structure as a chart. Moving someone can go through a request
  the new manager approves.
- **Teams.**
- **Customer accounts:** see section 7.
- **New members** get an onboarding checklist and reminders, and an employee ID is assigned
  automatically.

### Financials

Overview, payroll, payments, payment records, invoices and expenses. These **record** money
matters. The app does not send or receive money itself.

### Settings

Organization, members, schedules, activity & tracking, integrations, policies (such as work
breaks), compliance (what is collected, how long it is kept, exclusions, consent, devices,
requests to see or erase someone's data), enterprise security, and billing.

---

## 5. Rules and limits

### Starting the timer

- **Only one timer at a time per person,** across all their computers. Starting a second one
  is refused.
- **The tracker must be linked** to the person's account before the timer can start.
- **Projects that track by task** need a task picked before starting.
- **Time tracking can be switched off** for a person; then they cannot start the timer.
- **Days off:** the organization can block tracking on a person's days off. A shift that began
  on a working day and runs past midnight is not cut off by this.
- **A project whose budget is used up stops all its timers,** and no new timer can start on it.

### Hour limits

- **Each member can have a daily and a weekly hour limit,** measured in the project's time zone,
  or else the member's own. Weeks start on Monday.
- **Time added by hand** is refused if it would push the member over their daily limit, weekly
  limit, or their limit on that project. The message says by how much.
- **Tasks can have a daily hour limit.** When it is reached, the task's timer stops.
- **Assigning work** is refused if the task needs more hours per day than the member's daily
  limit, or if the assignment would take them over their weekly limit.
- **An Admin can lock a project's member limits;** then only Admins and Super Managers can change
  them.

### Idle time (per project)

- **Default:** 7.5 minutes.
- **Never less than 1 minute.**
- **Never more than half of the project's budget** (or of the member's limit on the project),
  converted to hours, so walking away can never use up the budget. If the budget cannot be put
  in hours, the most is 1 hour.
- **When idle time stops the timer,** at most one idle period is taken back from work time.
  Hours worked before that are never erased.

### Break time (per project)

- **Default:** 10 minutes.
- **Allowed range:** 1 minute to 8 hours.
- **A project can switch the limit off,** and then breaks only end when the member ends them.

### Sessions the tracker lost contact with

If the server hears nothing from a running tracker for **2 minutes**, it closes that session.
When the tracker comes back it can reopen the session, so the work is not lost.

### Screenshots and recorded data

- **How long data is kept:** screenshots, app records, website records and work sessions are each
  kept for **90 days** unless management sets another number. Only management can change this.
- **Screenshot storage:** screenshots move to cheaper long-term storage after **7 days**. A
  screenshot that fails to move stays where it was rather than being lost.
- **Who sees screenshots:** a member sees their own. Managers see their people's. Every
  screenshot view is logged.
- **Removal requests:** a member can ask to remove **only their own** screenshots. The reason can
  be up to 1,000 characters.
- **Deleting screenshots or editing their activity** needs a role that is allowed to do that.
- **Missing-screenshot and low-activity alerts** are not sent when the organization has turned
  screenshots off.

### Budgets

- **Projects and clients** can have budgets in hours or money: hourly, fixed, or monthly
  retainer. A budget can be per person, per project, or for the whole account.
- **Alerts** go out as a budget fills up. When it is used up, timers on that project stop.
- **Simultaneous edits:** if two people edit the same budget or project at once, the second save
  is refused with "someone else changed this", so nothing is silently overwritten.

### Passwords and signing in

- **Passwords:** 10 to 128 characters, with at least one capital letter, one small letter, one
  number and one symbol. Common passwords, simple sequences (1234, abcd) and repeated patterns
  are refused. Passwords do not expire.
- **New-device alerts:** signing in from a new device or place sends a security email.
- **Two-step sign-in** is not required.
- **Invite links** are valid for **7 days**.
- **Failed invite attempts:** after 5 failures in 15 minutes from one place, invites are
  blocked from there for 30 minutes.
- **Customer-account changes** need a code sent by email, valid for **10 minutes**.

### Messages and Buzz

- **Only the Owner can start a conversation** with a member. The member can reply but cannot
  start one.
- **Who can buzz:** the Owner and Super Admins. Anyone else's attempt is refused.
- **Where a buzz appears:** on the person's desktop tracker. If the tracker is not open, it
  appears in any dashboard tab they have open instead, so people who only use the browser can be
  buzzed too. It never shows up in both places at once.
- **Buzz only works live.** If neither the tracker nor a dashboard is open right now, nothing
  is sent, nothing is saved for later, and the sender is told.
- **Buzz limits:** the message is at most 140 characters, each person can be buzzed once every
  30 seconds, and the person can always close it at once.
- **Refreshing someone's page:** the Owner or a Super Admin can reload every dashboard tab a
  person has open, so it loads the latest version. The person sees a 10-second countdown that
  says who asked, with a **Refresh now** button. Anything they had not saved is lost. It only
  works while they have the dashboard open, and the same person's page can be refreshed at most
  once every 30 seconds.
- **Same organization only:** messages, buzzes and refreshes reach people in the sender's own
  organization only.

### Expenses, invoices and time off

- **Expenses:** an approved expense cannot be removed. Only people allowed to review a member's
  expenses can approve them.
- **Invoices:** a client invoice needs a client, a team invoice needs a member, and amounts must
  be above zero.
- **Time off:** policies need a name, and days per year cannot be negative. Adjusting someone's
  balance needs permission over that person. Clients do not request time off.

---

## 6. The public website

- **Product pages:** features, pricing, solutions, blog, resources, about and demo pages.
- **Contact form:** messages are checked and sent to the team.
- **Sign-in:** the website and the dashboard share the signed-in state, so signing in on one
  counts on the other.
- **Old page addresses** redirect to their new pages.
- **Unknown addresses** show a "page not found" page.

---

## 7. Customer accounts (separate organizations)

The Owner can create **customer organizations**: separate companies on the same system, each
with its own people and data, kept apart from every other organization.

- **A seat limit.** Each customer organization has a number of seats. A seat is taken by an
  active member, a pending invite, or an account that has not signed in yet. Adding or inviting
  past the limit is refused.
- **One root person.** Each customer organization has one Enterprise Super Manager or
  Enterprise Manager, who builds their own team under them.
- **Unlocking first.** Creating, renewing or changing customer organizations requires the Owner
  or a Super Admin to unlock it with an emailed code.

---

## 8. Not finished yet, and known limits

### Built but switched off

- **Signing in with a work email** (company single sign-on).
- **"Request access" screen.**
- **Import and export** of members and projects. Adding many people at once goes through
  invites instead.

### Known limits of the current setup

These are estimates, not load-tested.

- **People tracking at the same time:** about 1,500 to 2,500 on the current server.
- **Storage:** screenshots fill the server's disk first. Roughly 250 people with 3 weeks of
  screenshots each, depending on screenshot size.
- **Large organizations:** past about 300 projects, 3,000 project memberships or 800 tasks,
  some dashboard totals can quietly leave items out.
- **Signing the app:** the Windows app is not yet signed with a company certificate, so Windows
  may warn when it is installed.
- **Admin permission:** the tracker still asks for administrator permission on Windows. Removing
  that is planned.
