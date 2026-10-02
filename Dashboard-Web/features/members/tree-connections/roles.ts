// Role knowledge the Connections view needs, kept free of app imports so the whole module can be
// tested in plain Node. The rank table mirrors the server's (relation-sync.js ROLE_PRIVILEGE_RANK);
// the server stays the authority - this only lets the page avoid offering a move it will refuse.

const ROLE_ALIASES = new Map<string, string>([["supermanger", "supermanager"]])

const ROLE_RANK: Record<string, number> = {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  enterprisesupermanager: 70,
  manager: 60,
  enterprisemanager: 60,
  teamlead: 50,
  employee: 40,
  intern: 30,
  client: 20,
  viewer: 10,
}

export function roleKey(role: string | undefined | null): string {
  const key = String(role ?? "").trim().toLowerCase().replace(/\s+/g, "")
  return ROLE_ALIASES.get(key) ?? key
}

export function roleRank(role: string | undefined | null): number {
  const key = roleKey(role)
  if (!key) return -1
  return ROLE_RANK[key] ?? 35
}

export function isOwnerRole(role: string | undefined | null): boolean {
  return roleKey(role) === "owner"
}

/** Clients sit outside the hierarchy: they cannot report to anyone or manage anyone. */
export function isClientRole(role: string | undefined | null): boolean {
  return roleKey(role) === "client"
}

/** A stable colour per role so the same role reads the same everywhere on the canvas. */
const ROLE_COLOR: Record<string, string> = {
  owner: "#a855f7",
  superadmin: "#8b5cf6",
  admin: "#6366f1",
  supermanager: "#0ea5e9",
  enterprisesupermanager: "#f97316",
  manager: "#3b82f6",
  enterprisemanager: "#fb923c",
  teamlead: "#14b8a6",
  employee: "#22c55e",
  intern: "#eab308",
  client: "#f43f5e",
  viewer: "#94a3b8",
}

export function roleColor(role: string | undefined | null): string {
  return ROLE_COLOR[roleKey(role)] ?? "#64748b"
}
