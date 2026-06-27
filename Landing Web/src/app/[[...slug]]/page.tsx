import PageShell from "../../components/PageShell"

const pageContent: Record<string, { title: string; description: string; bullets: string[] }> = {
  "hour-logging": {
    title: "Hour logging",
    description: "Capture every work session with precision, transparency, and simple approvals.",
    bullets: ["Desktop and mobile tracking", "Task-level time entry", "Reliable timesheets for payroll"],
  },
  "output-visibility": {
    title: "Output visibility",
    description: "Give every leader a real-time view of progress, focus, and delivery health.",
    bullets: ["Live work activity", "Proof-of-work snapshots", "Team productivity signals"],
  },
  "workforce-signals": {
    title: "Workforce signals",
    description: "Turn daily activity into actionable signals for performance and planning.",
    bullets: ["Capacity planning", "Benchmark reporting", "Anomaly detection"],
  },
  "pay-invoicing": {
    title: "Pay and invoicing",
    description: "Connect tracked work to budgets, invoices, and payroll without manual reconciliation.",
    bullets: ["Budget tracking", "Invoice automation", "Overtime and pay rules"],
  },
  "connected-apps": {
    title: "Connected apps",
    description: "Bring Virtual Tracker into the tools your team already uses every day.",
    bullets: ["Native integrations", "Automation-friendly workflows", "Faster onboarding"],
  },
  "smart-timesheets": {
    title: "Smart timesheets",
    description: "Make timesheets effortless with intelligent suggestions and approvals.",
    bullets: ["Auto-generated entries", "One-click review", "Audit-ready history"],
  },
  "team-visibility": {
    title: "Team visibility",
    description: "See who is working, what they are focused on, and how delivery is tracking.",
    bullets: ["Availability insights", "Live status updates", "Cross-team coordination"],
  },
  "custom-reports": {
    title: "Custom reports",
    description: "Create the reporting views your leaders actually need to make decisions.",
    bullets: ["Executive summaries", "Flexible report builders", "Export-ready data"],
  },
  "client-invoicing": {
    title: "Client invoicing",
    description: "Turn tracked work into polished invoices and faster collections.",
    bullets: ["Billable hour summaries", "Invoice templates", "Client-ready reporting"],
  },
  "about-us": {
    title: "About us",
    description: "Virtual Tracker helps modern teams create accountability without adding friction.",
    bullets: ["Purpose-built for operations", "Designed for distributed teams", "Trusted by growing companies"],
  },
  "guiding-principles": {
    title: "Guiding principles",
    description: "Our approach is grounded in clarity, respect, and practical productivity.",
    bullets: ["Transparency first", "Flexible by design", "Built for real work"],
  },
  "reviews": {
    title: "Reviews",
    description: "See how teams evaluate Virtual Tracker across reliability, visibility, and ease of use.",
    bullets: ["Customer feedback", "Implementation stories", "Results-driven outcomes"],
  },
  "press": {
    title: "Press",
    description: "Media resources, announcements, and updates from the Virtual Tracker team.",
    bullets: ["Press releases", "Product announcements", "Media contact details"],
  },
  partners: {
    title: "Partners",
    description: "Explore integrations, channel partnerships, and strategic collaboration opportunities.",
    bullets: ["Partner programs", "Implementation partners", "Joint go-to-market opportunities"],
  },
  status: {
    title: "Status",
    description: "Track the current state of the platform, incidents, and planned improvements.",
    bullets: ["Live service updates", "Scheduled maintenance", "Incident history"],
  },
  "product-roadmap": {
    title: "Product roadmap",
    description: "See the direction of the platform and the upcoming priorities for teams and admins.",
    bullets: ["Upcoming releases", "Customer-driven roadmap", "Long-term platform direction"],
  },
  careers: {
    title: "Careers",
    description: "Join the team building the next generation of work management software.",
    bullets: ["Engineering roles", "Product and design", "Global remote opportunities"],
  },
  "download-virtual-tracker": {
    title: "Download Virtual Tracker",
    description: "Install Virtual Tracker for desktop and mobile workflows.",
    bullets: ["Windows and Mac", "Mobile access", "Offline-friendly tracking"],
  },
  "mac-time-tracker": {
    title: "Mac time tracker",
    description: "Track work from Mac devices with a lightweight desktop experience.",
    bullets: ["Native desktop app", "Quick-start timers", "Hands-free tracking"],
  },
  "linux-time-tracker": {
    title: "Linux time tracker",
    description: "Support clock-in flows and reporting from Linux-based workstations.",
    bullets: ["Flexible setup", "Terminal-friendly experience", "Cross-team visibility"],
  },
  "windows-time-tracker": {
    title: "Windows time tracker",
    description: "Use Virtual Tracker on Windows with robust tracking and reporting options.",
    bullets: ["Desktop efficiency", "Keyboard shortcuts", "Reliable session capture"],
  },
  "web-time-tracker": {
    title: "Web time tracker",
    description: "Track work from any browser with the same reporting and billing workflows.",
    bullets: ["Browser-based access", "No-install experience", "Secure cloud sync"],
  },
  "help-center": {
    title: "Help center",
    description: "Find guides, tutorials, and answers for setup and everyday use.",
    bullets: ["Setup walkthroughs", "Troubleshooting articles", "Video guides"],
  },
  "sign-in": {
    title: "Sign in",
    description: "Access your workspace, dashboard, and reporting tools securely.",
    bullets: ["Fast sign-in flow", "Workspace switching", "Secure authentication"],
  },
  pricing: {
    title: "Pricing",
    description: "Choose a plan that fits your team’s operations and growth stage.",
    bullets: ["Flexible plans", "Scalable features", "Dedicated support for larger teams"],
  },
  demo: {
    title: "Demo",
    description: "See how Virtual Tracker supports the full workflow from time capture to reporting.",
    bullets: ["Guided tour", "Live product walkthrough", "Tailored use cases"],
  },
  "contact-us": {
    title: "Contact us",
    description: "Get in touch for product questions, rollout support, or tailored demos.",
    bullets: ["Sales support", "Implementation guidance", "Product feedback"],
  },
  "resource-hub": {
    title: "Resource hub",
    description: "Explore educational material designed to help you plan and scale your rollout.",
    bullets: ["Implementation guides", "Best-practice playbooks", "Reporting examples"],
  },
  "time-tracking-resources": {
    title: "Time tracking resources",
    description: "Learn how great time tracking improves delivery, billing, and accountability.",
    bullets: ["Workflow recommendations", "Team adoption tips", "Productivity benchmarks"],
  },
  "roi-calculator": {
    title: "ROI calculator",
    description: "Estimate the time and cost impact of switching to a more transparent tracking workflow.",
    bullets: ["Potential savings", "More accurate planning", "Improved resource utilization"],
  },
  "buy-in-guide": {
    title: "Buy-in guide",
    description: "Prepare your case for rollout with practical talking points and success stories.",
    bullets: ["Stakeholder messaging", "Adoption plan", "Executive summary"],
  },
  faq: {
    title: "FAQ",
    description: "Quick answers to common questions about tracking, payroll, and reporting.",
    bullets: ["Setup questions", "Billing questions", "Security questions"],
  },
  "customer-stories": {
    title: "Customer stories",
    description: "Hear how teams use Virtual Tracker to improve operations and visibility.",
    bullets: ["Real-world use cases", "Outcome-focused stories", "Team adoption lessons"],
  },
  blog: {
    title: "Blog",
    description: "Read the latest product updates, productivity trends, and operational insights.",
    bullets: ["Product updates", "Workplace trends", "Best practices"],
  },
  toggl: {
    title: "Toggl",
    description: "A comparison page for teams exploring alternatives to manual time tracking tools.",
    bullets: ["Feature comparison", "Workflow fit", "Pricing context"],
  },
  clockify: {
    title: "Clockify",
    description: "Understand how Virtual Tracker compares with Clockify for teams that need deeper operations insight.",
    bullets: ["Reporting depth", "Billing workflows", "Team visibility"],
  },
  insightful: {
    title: "Insightful",
    description: "Metrics and tracking comparison for teams evaluating workforce productivity tools.",
    bullets: ["Visibility and reporting", "Operational customization", "Security and controls"],
  },
  apploye: {
    title: "Apploye",
    description: "A practical comparison page for organizations exploring Apploye alternatives.",
    bullets: ["Employee experience", "Accuracy and automation", "Enterprise readiness"],
  },
  activtrak: {
    title: "ActivTrak",
    description: "See how Virtual Tracker differs from activity-focused monitoring tools.",
    bullets: ["Balanced productivity insights", "Workforce empathy", "Actionable reporting"],
  },
  "time-doctor": {
    title: "Time Doctor",
    description: "Compare Virtual Tracker against more surveillance-heavy tracking experiences.",
    bullets: ["Transparency", "Workflow flexibility", "Payroll and billing"],
  },
  desktime: {
    title: "Desktime",
    description: "Compare Virtual Tracker with Desktime for modern time and workflow management.",
    bullets: ["Automation", "Operational control", "Team-friendly UX"],
  },
  "see-all-comparisons": {
    title: "See all comparisons",
    description: "Browse the full set of alternatives and comparison guides for Virtual Tracker.",
    bullets: ["Product alternatives", "Category comparisons", "Buying guidance"],
  },
}

export default async function CatchAllPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const path = slug?.join("/") || ""
  const page = pageContent[path] || {
    title: "Coming soon",
    description: "This section is now available as a dedicated landing page for Virtual Tracker.",
    bullets: ["More product detail", "More resources", "More customer stories"],
  }

  return (
    <PageShell className="bg-white text-slate-900">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-24 lg:px-8">
        <div className="max-w-3xl rounded-3xl border border-slate-200 bg-slate-50 p-10 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-violet-600">Virtual Tracker</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">{page.title}</h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">{page.description}</p>
          <ul className="mt-8 space-y-3 text-sm text-slate-700">
            {page.bullets.map((bullet) => (
              <li key={bullet} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </PageShell>
  )
}
