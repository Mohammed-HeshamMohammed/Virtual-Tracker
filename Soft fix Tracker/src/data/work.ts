export type WorkTask = { id: string; title: string; done?: boolean };
export type WorkProject = { id: string; name: string; color: string; tasks: WorkTask[] };

export const projects: WorkProject[] = [
  {
    id: "nova-vanguard",
    name: "Nova Vanguard",
    color: "violet",
    tasks: [
      { id: "t1", title: "Ship the Lounge navigation revision" },
      { id: "t2", title: "Pair on the authentication flow" },
      { id: "t3", title: "Review the design QA pass", done: true }
    ]
  },
  {
    id: "buffalo-campaign",
    name: "Buffalo Campaign",
    color: "cyan",
    tasks: [
      { id: "t4", title: "Draft the client budget report" },
      { id: "t5", title: "Follow up on the invoice aging list" }
    ]
  },
  {
    id: "rws",
    name: "RWS Campaign",
    color: "gold",
    tasks: [
      { id: "t6", title: "Reconcile weekly limits for the team" },
      { id: "t7", title: "Prep the shift attendance export", done: true }
    ]
  },
  {
    id: "internal",
    name: "Soft Fix Internal",
    color: "green",
    tasks: [
      { id: "t8", title: "Write this week's changelog" }
    ]
  }
];

export const statTiles = [
  { label: "Today", value: "5h 12m", note: "across every project" },
  { label: "This week", value: "27h 40m", note: "of a 40h limit" },
  { label: "Activity", value: "86%", note: "keyboard & mouse" },
  { label: "Project budget", value: "26%", note: "spent so far" }
];

export const teammates = [
  { initials: "SA", name: "Sara Ahmed", status: "Tracking · Nova Vanguard", color: "violet", tracking: true },
  { initials: "YK", name: "Youssef Khaled", status: "Tracking · Buffalo Campaign", color: "cyan", tracking: true },
  { initials: "MN", name: "Mariam Nabil", status: "On a break", color: "gold", tracking: false },
  { initials: "OA", name: "Omar Adel", status: "Tracking · RWS Campaign", color: "green", tracking: true },
  { initials: "NH", name: "Nour Hany", status: "Not tracking", color: "blue", tracking: false }
];
