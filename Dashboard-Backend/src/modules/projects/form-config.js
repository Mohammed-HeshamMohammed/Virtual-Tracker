export const PROJECT_FORM_TABS = [
  { key: "general", label: "GENERAL" },
  { key: "members-teams", label: "MEMBERS & TEAMS" },
  { key: "budget", label: "BUDGET LIMITS" },
  { key: "limits", label: "MEMBERS LIMITS" },
];

export const PROJECT_FORM_FIELDS = [
  {
    key: "clientIds",
    label: "Clients",
    type: "multiselect",
    tab: "general",
    placeholder: "Select clients",
    optionsSource: "clients",
  },
  {
    key: "managers",
    label: "Manager",
    type: "multiselect",
    tab: "members",
    placeholder: "Select managers",
    optionsSource: "members",
    projectRole: "manager",
    roleFilter: "manager_and_above",
    helper: "Oversees and manages the project",
  },
  {
    key: "users",
    label: "Employees and clients",
    type: "multiselect",
    tab: "members",
    placeholder: "Select employees or clients",
    optionsSource: "members",
    projectRole: "user",
    // Clients are listed here too: a Client member added to the project is
    // how they get to see it without a client record linked to them.
    roleFilter: "employee_or_client",
    helper: "Works on the project (employee-level access); a client sees the project",
    withInfo: true,
  },
  {
    key: "teams",
    label: "Teams",
    type: "multiselect",
    tab: "teams",
    placeholder: "Select teams",
    optionsSource: "teams",
  },
  {
    key: "memberLimitMembers",
    label: "Members",
    type: "multiselect",
    tab: "budget",
    budgetSubTab: "member-limits",
    placeholder: "Select members",
    optionsSource: "members",
  },
];
