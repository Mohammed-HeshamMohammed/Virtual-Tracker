# The My Virtual Tracker Desktop App: What It Does and the Rules It Follows

A plain-language guide to the app people download and run on their computer: every screen,
every button, what it records, and every rule it follows. It is written for the people who use
it and the people who manage them, not for engineers. It was checked against the app's code on
2026-11-26.

---

## 1. What the app is for

You download the app, sign in, pick what you are working on, and press **Start**. While the
timer runs, the app counts your work time and records what your organization has chosen to
collect: how active you are, which apps and websites you use, and screenshots. Everything
goes to your organization's dashboard, and you can always see what was collected about you.

**Computers it runs on**
- Windows 10 and 11 (the main version).
- A separate version for older Windows 7, 8 and 8.1.
- Mac and Linux versions are also made, but some features below are Windows-only, and they
  say so.

---

## 2. Installing and signing in

### Signing in

You can sign in in three ways:
- **Email and password.**
- **Continue with Google** or **Continue with Apple.**
- **Link account via browser.** The app opens a page in your browser, you sign in there, and
  the app is connected.

If your account has no password (because you use Google or Apple), the app tells you to use
**Link account** instead.

### Creating an account

You can create an account from the app. You give your first and last name, phone number, email
and a password. The password must have:
- at least 10 characters,
- a capital letter, a small letter, a number and a symbol,
- no simple pattern (like 1234 or aaaa).

The app shows each rule turning green as you type.

### Forgot your password

**Email me a link to reset my password** sends a reset link to your email.

### Linked devices

- **Each computer is linked to your account** and registered as a device.
- **If the link is lost,** the app shows **Welcome back**. You can reconnect and carry on, or
  sign in as a different person.

### The monitoring notice

If your organization requires it, you must read a notice that says what is collected and why,
and confirm it, **before** the timer will start. The timer stays locked until you do.

---

## 3. The main screen

### Sidebar

- **Your projects:** the projects you belong to, with a filter box. The **+** next to a project
  adds a task to it. A project whose hours budget is used up is marked **Budget spent**, and no
  timer can start on it.
- **Your tasks:** the tasks in the chosen project, with a filter box. You cannot switch tasks
  while the timer is running.
- **Your team:** who on your team is tracking right now and who is on a break.
- **Weekly activity:** how active you were this week, with active and idle time.
- **The bottom of the sidebar:**
  - Your profile, **Privacy** and **Settings**.
  - A status light: green while tracking, other colours for a break, offline, signed out, or
    not linked.

### The middle of the screen

- **Today:** what you worked today across every project. If you have a daily limit, it also
  shows how much of it is left; when the limit is used up it shows **Cap reached**.
- **This week:** what you worked this week, against your weekly limit if you have one.
- **Activity:** how active you were today, from keyboard and mouse use.
- **Your week:** a bar for each day showing:
  - time worked,
  - time added by hand (in its own colour),
  - idle time (stacked on top).
- **Project budget:** how much of the project's budget is left. "Yours" is a personal budget;
  "team" is shared. It also shows when the budget starts again from zero.
- **This task:**
  - its description, priority, due date and checklist,
  - how far along it is, and how much of its budget is left.
- **Assigned to me / Assigned tasks today:** how much work is assigned to you, and how much of
  it is planned for today.
- **Project details:** this week's top apps and recent screenshots for the project.
- **Your recent screenshots:** the latest screenshots of your screen. Click one to see it larger.

### Buttons

| Button | What it does |
|---|---|
| **Start tracking** | Starts the timer on the chosen project and task. |
| **Pause tracking** | "I'm at my desk but not working on this." See section 4. |
| **Take a break** | "I'm away from my desk." See section 4. |
| **Resume tracking** | Back to work. |
| **Stop tracking** | Stops the timer and saves your time. |
| **Open the web dashboard** | Opens the dashboard in your browser. |

### Other ways to view it

- **Mini timer:** a small floating timer. One click brings back the full app.
- **Easy read:** large text and only what you need (project, task, today's time and the
  buttons), for people with low vision.
- **Guided tour:** walks you through the screen.
- **Hover help:** every button explains itself when you point at it.

---

## 4. Tracking your time

### Starting

1. Choose a project.
2. Choose a task, if the project works with tasks. Some projects require one.
3. Press **Start tracking**.

You can only change the project or task while the timer is stopped.

### The three ways to stop for a moment

| | Pause | Break | Private break |
|---|---|---|---|
| **Means** | At your desk, not working on this | Away from your desk | Away, and you want nothing recorded |
| **Timer** | Stops | Stops | Stops |
| **Apps and websites** | Still recorded | Not recorded | Not recorded |
| **Screenshots** | Not taken | Not taken | Not taken |
| **How it ends** | Only when you press Resume | By itself after the project's break time, or when you resume | After the length you chose, or when you end it |
| **Your manager sees** | That you paused | That you took a break | That you took a break, and your reason |

- **Private breaks** need a reason, and you can only choose the lengths your project allows.
- **When a break ends by itself,** the app tells you: "Break ended — timer resumed".

### Stopping

Press **Stop tracking**. Some projects ask for a short note about what you got done before the
timer stops. **Go back** keeps the timer running.

### Adding time by hand

**Log time** adds time you worked but never tracked. You give:
- the project,
- the day,
- how many hours,
- what you worked on (optional).

The limits in section 7 apply.

### Other things you can do from the app

- **Create a task:** title, description, priority, due date, and how long you expect it to take.
- **Ask for time off:** choose the kind of leave, the first and last day, and an optional note.
  It goes to whoever approves leave for you. The last day cannot be before the first.
- **Submit your timesheet:** send your time for a pay period for approval.

---

## 5. What the app records, and when

**Only while the timer is running,** and only what your organization has switched on.

| What | How often | Details |
|---|---|---|
| **Activity level** | Measured every minute | How much the keyboard and mouse were used, turned into a score. It counts how much, never what you typed. |
| **Apps** | Every 15 seconds | Which program is in front. |
| **Websites** | Every 15 seconds | For browsers, which website is open. |
| **Screenshots** | At a random moment every 1.5 to 3.5 minutes | The first one is about 5 seconds after you start. They are reduced to at most 1280 pixels wide. |

**Fake activity is spotted.** Mouse jigglers and other tools that fake keyboard or mouse use
are detected, and the activity is flagged.

### When nothing is recorded

- **During breaks and private breaks,** and while paused (except apps and websites).
- **Outside your work hours,** if your organization set work hours.
- **When your organization has switched screenshots off.** The app says so.
- **For apps and websites on your "Never capture" list** (section 6).

The app shows a **Not capturing** banner whenever nothing is being captured, with the reason.
If screenshots keep failing on your computer, it shows **Screenshots are failing**.

---

## 6. Privacy: what you control

Open **Privacy** from the bottom of the sidebar.

- **Collected today:** exactly what has been collected about you so far today.
- **Never capture:** add apps (for example a password manager) or websites (for example your
  bank) that are never captured: no screenshots and no activity. A website covers all its
  sub-sites too. This can only reduce what is collected, never add to it.
- **Blur strength:** screenshots can be blurred.
  - **Standard:** text cannot be read, but you can tell what kind of page it was.
  - **Strong:** the page is only a soft smudge of colour.
  - **Maximum:** nothing but the overall colour of the page.

  **Chat apps and social media** (Facebook, Instagram, TikTok, Snapchat and similar) are
  **always** blurred. You can make the blur stronger, but never weaker than Standard.
- **Screen to record:** with more than one monitor, you can choose which screen screenshots are
  taken of. Your apps and websites are still recorded.
- **Private break:** see section 4.

**Removing a screenshot.** If a screenshot caught something private, you can ask for it to be
removed from the dashboard. See the main guide, `GUIDE-what-it-does-and-the-rules.md`.

---

## 7. Rules the timer follows

### When the timer will not start

| Situation | What you see |
|---|---|
| You have not read the monitoring notice | "Review the monitoring notice before starting the timer." |
| The project needs a task and none is chosen | "Select a task first" |
| No project is chosen | "Select a project first" |
| The project's budget is used up | **Budget spent** |
| Your daily or weekly limit is used up | **Daily limit reached** / "Maximum allowed work time reached." |
| Time tracking is turned off for you or the project | Start is refused |
| Today is not one of your working days | "Today is not a scheduled working day — tracking is disabled." (A scheduled make-up day is allowed.) |
| The timer is already running on another of your computers | Refused. **Only one timer per person,** on all computers. |

### When the timer stops by itself

The app always tells you why:

- **"Timer stopped — project's budget limit reached"**
- **"Timer stopped — task's daily hour limit reached"**
- **"Timer stopped — time tracking was turned off for you or this project"**
- **"Timer stopped — it was ended elsewhere"**: from another computer, the dashboard, or a limit.
- **"Timer stopped — the computer was asleep too long"**: see "Sleep" below.
- **Idle:** see below.

### Idle time

- **Each project has an idle time.** If you do not touch the keyboard or mouse for longer than
  that, the timer stops by itself.
- **The time since your last real input is taken out of your work time** and counted as idle.
  Only that stretch is taken back. Time you worked before it is never removed.
- **The project's idle time** is 7.5 minutes unless the project sets another. It is never less
  than 1 minute, and never more than half of the project's budget (so walking away can never
  use up the budget).
- **A project can switch idle time off.** Then the timer never stops for idleness.
- **The automatic idle stop works on Windows only.**

### Break length

The project's break time is **10 minutes** unless the project says otherwise. It can be
anything **from 1 minute to 8 hours**, or switched off so breaks only end when you end them.

### Sleep

- **Up to 15 minutes asleep:** the timer is only paused, and it continues when the computer
  wakes.
- **Longer than that:** the timer is stopped on waking, and the time asleep is not counted.

### If the app or computer restarts while the timer runs

The timer stops. When the app opens again it says so, and **Start again** picks up the same
project and task. Time between the restart and pressing Start again is **not** counted.

### Midnight

Time belongs to the day it was worked. A pause that runs past midnight is closed and continued on
the new day, so tomorrow's time is not put on today.

### Time zone

Your day is counted in the project's time zone when the project has one; then only the project
can change it. Otherwise it uses your own time zone, which you can pick in the app by searching
for a city, a country or a time offset.

### Your limits

- **Daily and weekly limits.** Your organization can give you a daily and a weekly hour limit,
  shown under **Work-hour limits** in your profile. Weeks start on Monday.
- **Time added by hand** cannot push you over your daily, weekly or project limit.

---

## 8. When the internet drops

- **The timer keeps counting** and the app says "Connection lost — time is still being counted
  locally."
- **Everything recorded is saved on your computer** and sent when the connection returns: "Back
  online — your time is syncing again."
- **There is a cap on what is saved:** up to 2,000 saved batches or 200 MB, whichever comes
  first. Past that, the oldest are dropped. This only matters after a very long outage.
- **Reconnect** tries straight away instead of waiting.
- **If the server stops hearing from your app for 2 minutes,** it closes the session on its side.
  When the app comes back it reopens it, so the time is kept.

---

## 9. Messages and Buzz

- **Messages.** The Owner can send you a message. It appears in the app and as a Windows
  notification. You can reply, but you cannot start a conversation.
- **Buzz.** The Owner or a Super Admin can send a playful poke: a small pop-up in a corner, or
  a joke "blue screen" ("Your PC ran into a problem and needs you to focus").
  - It only arrives while your app is connected. If the app is closed but you have the web
    dashboard open, it appears there instead.
  - The message is at most 140 characters.
  - You can always close it at once.
  - You can be buzzed at most once every 30 seconds.

---

## 10. Your profile

- **Your details:** your name, email and role as your organization has them, and when you joined.
- **Earnings:** what you earned this week and this month, if your organization shows pay.
- **Work-hour limits:** your daily and weekly limits and how much you have used.
- **Timesheet:** your latest timesheet. **Submit timesheet** sends your time for approval.
- **Time off:** **Ask for time off.**
- **Log out:** signs this computer out.

---

## 11. Settings

| Setting | What it does |
|---|---|
| **Appearance** | Light, dark, or follow your computer. Matches the dashboard's themes. |
| **Window layout** | Auto (picks the best size for your screen), or a fixed size for small laptops, most screens, or large monitors. Easy read is here too. |
| **Show apps & screenshots** | Shows or hides the side column with this week's top apps and recent screenshots. |
| **Open with Windows** | Starts the app when you sign in to your computer. |
| **Start in tray** | Starts the app hidden, in the system tray. |
| **Keep running in tray** | Closing the window hides it instead of quitting. |
| **Auto sign-in** | Opens the browser sign-in page by itself when you are signed out. |
| **Diagnostics** | Opens the app's log file, which support may ask you for. |

---

## 12. The tray icon

The icon next to the clock shows:
- whether you are tracking,
- **Pause / Resume tracking,**
- **Stop session,**
- **Open the Dashboard,**
- **Sign in** (when signed out),
- **Quit My Virtual Tracker.**

---

## 13. Updates

- **Updates download by themselves.** They install when you are not tracking, or when you choose.
- **Every update is checked against the company's signature,** so a fake update is refused.
- **On computers where the person is not an administrator,** the app may not be able to install
  its own updates. It reports this to the organization instead of silently staying on an old
  version.

---

## 14. Things to know

- **Administrator permission.** On Windows the app asks for administrator permission when it
  starts. Removing this is planned.
- **The installer is not yet signed with a company certificate,** so Windows may show a warning
  when you install it.
- **Some features are Windows-only:** the automatic idle stop and spotting fake activity.
- **If the app's window stops responding,** the app notices and recovers it.
