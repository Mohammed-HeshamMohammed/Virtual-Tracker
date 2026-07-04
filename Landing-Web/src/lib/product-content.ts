/** Product copy for landing pages. */

export const PRODUCT_TAGLINE =
  "Work tracking and utilization monitoring for distributed teams."

export const PRODUCT_DESCRIPTION =
  "Virtual Tracker combines task-linked time tracking, desktop activity capture, project management, and org hierarchy — backed by Firebase with backend-enforced permissions."

export const HERO_CYCLING_WORDS = ["distributed", "remote", "operations", "project", "growing"] as const

export const HERO_TABS = [
  {
    label: "Time tracking",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    href: "/time-tracking",
  },
  {
    label: "Activity capture",
    icon: "M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z",
    href: "/activity-capture",
  },
  {
    label: "Projects & tasks",
    icon: "M4 6h16M4 10h16M4 14h16M4 18h16",
    href: "/projects-tasks",
  },
  {
    label: "People & teams",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    href: "/people-teams",
  },
  {
    label: "Desktop agent",
    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2",
    href: "/desktop-agent",
  },
] as const

export const PLATFORM_NAV_TABS = [
  {
    label: "Time tracking",
    heading: "Task-linked time capture",
    subheading: "Start a timer from the web dashboard, log time on tasks, and review entries in timesheets.",
    href: "/time-tracking",
    features: [
      { title: "Web task timer", desc: "Top-bar timer tied to active tasks and projects." },
      { title: "Time entries", desc: "View and edit logged hours in the timesheets workspace." },
      { title: "Task assignments", desc: "Track time against assigned work with review queues." },
      { title: "Submit & approve APIs", desc: "Backend workflows for timesheet submit, approve, and reject." },
    ],
    cta: { label: "See time tracking", link: "Open dashboard" },
  },
  {
    label: "Activity capture",
    heading: "Screenshots, apps, and URLs",
    subheading: "While the timer is active, the desktop agent records foreground apps, browser URLs, and periodic screenshots.",
    href: "/activity-capture",
    features: [
      { title: "Screenshot feed", desc: "Periodic full-screen captures stored in Firebase Storage." },
      { title: "Apps feed", desc: "Foreground application and window title logging." },
      { title: "URLs feed", desc: "Browser address-bar capture on Windows and macOS." },
      { title: "Org-scoped visibility", desc: "Activity access enforced by role and hierarchy rules." },
    ],
    cta: { label: "Activity feeds", link: "Explore activity" },
  },
  {
    label: "Projects & tasks",
    heading: "Clients, projects, and delivery",
    subheading: "Manage clients, projects, tasks, and budgets from the project management workspace.",
    href: "/projects-tasks",
    features: [
      { title: "Projects & clients", desc: "CRUD for projects and clients with budget metadata." },
      { title: "Task board & timeline", desc: "List, board, and timeline views with drag-reorder." },
      { title: "PM overview", desc: "Aggregated project health and workload signals." },
      { title: "Client budgets", desc: "Operational budget caps and invoicing metadata." },
    ],
    cta: { label: "Project management", link: "View projects" },
  },
  {
    label: "People & teams",
    heading: "Org hierarchy and presence",
    subheading: "Invite members, manage roles, visualize the org tree, and see who is online in real time.",
    href: "/people-teams",
    features: [
      { title: "Members & invites", desc: "Bulk invites, open-link registration, and pre-provisioned accounts." },
      { title: "Hierarchy tree", desc: "Visual org graph with role-based visibility." },
      { title: "Teams & bans", desc: "Team rosters and member ban management." },
      { title: "Live presence", desc: "WebSocket and SSE presence with Firebase RTDB." },
    ],
    cta: { label: "People workspace", link: "Manage team" },
  },
  {
    label: "Desktop agent",
    heading: "Windows and macOS agent",
    subheading: "Native Python agent links to your workspace and ingests activity while the web timer runs.",
    href: "/desktop-agent",
    features: [
      { title: "Secure agent link", desc: "Token exchange flow via /api/activity/agent/link." },
      { title: "Windows & macOS", desc: "Supported desktop platforms in Python-App-Extension." },
      { title: "Launcher orchestration", desc: "Local dev launcher starts API, dashboard, and agent together." },
      { title: "Web fallback capture", desc: "Browser-based activity reporting when the agent is not used." },
    ],
    cta: { label: "Agent setup", link: "Get the agent" },
  },
] as const

export const SOLUTIONS = [
  {
    title: "Remote operations",
    description: "Track task time and activity across distributed teams with live presence and org-scoped feeds.",
    href: "/solutions",
  },
  {
    title: "Client services",
    description: "Connect clients, projects, and tasks so billable work stays tied to delivery.",
    href: "/solutions",
  },
  {
    title: "Team leads & managers",
    description: "Review member activity, assignments, and timesheet entries from one dashboard.",
    href: "/solutions",
  },
  {
    title: "Trial deployments",
    description: "Firebase-backed trial client with branded auth, invites, and desktop agent support.",
    href: "/solutions",
  },
] as const

export const FEATURE_GROUPS = [
  {
    title: "Time tracking",
    description: "Log hours against tasks from the web dashboard with a built-in timer and timesheet views.",
    points: ["Task-linked timer", "Time entry view & edit", "Timesheet submit/approve APIs"],
    href: "/time-tracking",
  },
  {
    title: "Activity visibility",
    description: "Desktop agent and web capture feed screenshots, apps, and URLs into scoped activity views.",
    points: ["Screenshot feed", "Apps & URLs feeds", "Hierarchy-aware access"],
    href: "/activity-capture",
  },
  {
    title: "Operations backbone",
    description: "Projects, clients, members, and teams on Firebase with backend-enforced authorization.",
    points: ["Org hierarchy & invites", "Projects, tasks, clients", "Real-time presence"],
    href: "/people-teams",
  },
] as const

export const HOME_FEATURES = [
  {
    tag: "TIME TRACKING",
    title: "Timer tied to real work",
    body: "Start and stop a session from the dashboard top bar while working on an assigned task or project.",
    points: ["Web task timer", "Time entries in timesheets", "Task review queue"],
    cta: "Time tracking",
    href: "/time-tracking",
    stat: "Timer",
    statLabel: "Dashboard top bar",
  },
  {
    tag: "ACTIVITY CAPTURE",
    title: "Desktop agent ingestion",
    body: "The Python agent records screenshots, foreground apps, and browser URLs while the timer is active.",
    points: ["Windows & macOS agent", "Screenshots, apps, URLs", "Secure link flow"],
    cta: "Activity capture",
    href: "/activity-capture",
    stat: "3",
    statLabel: "Activity feed types",
  },
  {
    tag: "PROJECT DELIVERY",
    title: "Clients, projects, and tasks",
    body: "Run delivery from the project management workspace with overview dashboards and task boards.",
    points: ["Clients & projects", "Task board & timeline", "Budget metadata"],
    cta: "Projects & tasks",
    href: "/projects-tasks",
    stat: "PM",
    statLabel: "Overview workspace",
  },
  {
    tag: "PEOPLE & PRESENCE",
    title: "Org hierarchy that scales",
    body: "Invite members, assign roles, visualize the tree, and see online status over WebSocket presence.",
    points: ["Invites & pre-provision", "Member tree", "Live presence"],
    cta: "People & teams",
    href: "/people-teams",
    stat: "RTDB",
    statLabel: "Presence layer",
  },
] as const

export const PLATFORM_STATS = [
  { value: "2", label: "Desktop platforms (Windows & macOS)" },
  { value: "3", label: "Activity feeds (screenshots, apps, URLs)" },
  { value: "6+", label: "Dashboard workspaces in the app" },
  { value: "1", label: "Firebase-backed source of truth" },
] as const

export const VALUE_PROPS = [
  {
    title: "Backend-enforced access",
    body: "Session authorization checks email verification, member linkage, and account status before API access.",
    href: "/features",
  },
  {
    title: "Hierarchy-aware visibility",
    body: "Member relationships and role ladders control who sees people, activity, and project data.",
    href: "/people-teams",
  },
  {
    title: "Built for trial rollouts",
    body: "Branded Firebase auth, invite flows, desktop agent linking, and a local Launcher for dev orchestration.",
    href: "/desktop-agent",
  },
] as const

export const TRUST_CARDS = [
  {
    title: "Firebase authentication",
    body: "Email/password and Google sign-in with branded verification and backend password policy validation.",
    href: "/features",
    cta: "Auth & onboarding",
  },
  {
    title: "Org-scoped data",
    body: "Firestore holds domain data; presence is ephemeral in RTDB. Backend owns business rules.",
    href: "/people-teams",
    cta: "People & hierarchy",
  },
  {
    title: "Transparent activity model",
    body: "Activity is captured while the timer runs — screenshots, apps, and URLs with role-based feed access.",
    href: "/activity-capture",
    cta: "Activity capture",
  },
] as const

export const FOOTER_COLS = [
  {
    title: "Product",
    links: [
      { label: "Time tracking", href: "/time-tracking" },
      { label: "Activity capture", href: "/activity-capture" },
      { label: "Projects & tasks", href: "/projects-tasks" },
      { label: "People & teams", href: "/people-teams" },
      { label: "Timesheets", href: "/timesheets" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Desktop agent", href: "/desktop-agent" },
      { label: "Web dashboard", href: "/features" },
      { label: "Launcher (dev)", href: "/desktop-agent" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Features", href: "/features" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Sign in", href: "/sign-in", useAppLink: true },
      { label: "Product demo", href: "/demo" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Learn more",
    links: [
      { label: "Solutions", href: "/solutions" },
      { label: "Resources", href: "/resources" },
      { label: "Blog", href: "/blog" },
      { label: "FAQ", href: "/faq" },
    ],
  },
] as const

export const PRICING_PLANS = [
  {
    name: "Trial",
    price: "Evaluation",
    description: "Full trial client for pilots and internal rollouts.",
    features: ["Time tracking & activity", "Projects, tasks, clients", "Org hierarchy & invites", "Desktop agent (Win/Mac)"],
  },
  {
    name: "Team",
    price: "Contact us",
    description: "For teams deploying Virtual Tracker on their Firebase project.",
    features: ["Role-based visibility", "Member invites & transfers", "Presence & notifications", "Engineering support for setup"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "Multi-workspace or dedicated deployment discussions.",
    features: ["Custom onboarding", "Security review support", "Roadmap alignment", "Dedicated success contact"],
  },
] as const

export const BLOG_POSTS = [
  {
    slug: "desktop-agent-setup",
    title: "Setting up the Virtual Tracker desktop agent",
    excerpt: "Link the Windows or macOS Python agent to your workspace and start ingesting activity while the timer runs.",
    date: "June 2026",
  },
  {
    slug: "org-hierarchy-and-invites",
    title: "Org hierarchy, invites, and member onboarding",
    excerpt: "How invites, pre-provisioned accounts, and the member tree work in the trial client.",
    date: "June 2026",
  },
  {
    slug: "task-linked-time-tracking",
    title: "Task-linked time tracking in the dashboard",
    excerpt: "Using the web timer, time entries, and timesheet views to keep work tied to delivery.",
    date: "June 2026",
  },
] as const

export const SLUG_PAGES: Record<string, { title: string; description: string; bullets: string[] }> = {
  "time-tracking": {
    title: "Time tracking",
    description: "Log work from the web dashboard with a task-linked timer and timesheet views.",
    bullets: ["Top-bar task timer", "Time entry view & edit", "Timesheet submit/approve APIs"],
  },
  "activity-capture": {
    title: "Activity capture",
    description: "Desktop agent and web capture feed screenshots, apps, and URLs into scoped activity views.",
    bullets: ["Screenshot feed", "Apps feed", "URLs feed", "Org-scoped access rules"],
  },
  "projects-tasks": {
    title: "Projects & tasks",
    description: "Manage clients, projects, tasks, and budgets from the project management workspace.",
    bullets: ["Projects & clients CRUD", "Task board & timeline", "PM overview", "Budget metadata"],
  },
  "people-teams": {
    title: "People & teams",
    description: "Invite members, manage roles, visualize the org tree, and monitor live presence.",
    bullets: ["Invites & pre-provision", "Member hierarchy tree", "Teams & bans", "WebSocket presence"],
  },
  "desktop-agent": {
    title: "Desktop agent",
    description: "Native Python agent for Windows and macOS — links to your workspace and ingests activity while the timer is active.",
    bullets: ["Secure agent link API", "Screenshots every 90–210s", "App/window logging every 30s", "Browser URL capture"],
  },
  timesheets: {
    title: "Timesheets",
    description: "Review and edit time entries. Approval UI is on the roadmap; submit/approve APIs exist today.",
    bullets: ["View & edit time entries", "Task review queue", "Submit/approve backend APIs"],
  },
  "help-center": {
    title: "Help center",
    description: "Product documentation lives in the app/docs folder of the repository and in-app engineering guides.",
    bullets: ["Project Hierarchy doc", "Member visibility guide", "Authentication & verification doc"],
  },
  faq: {
    title: "FAQ",
    description: "Common questions about what Virtual Tracker ships today versus what is on the roadmap.",
    bullets: [
      "Does it process payroll? No — budgets and pay rates are metadata only.",
      "Are Slack/Jira connected? Not yet — integrations are planned UI.",
      "Which OSes does the agent support? Windows and macOS.",
    ],
  },
}
