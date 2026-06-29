/** Mirrors Backend `ROLE_PRIVILEGE_RANK` in relation-sync.js */
export const ROLE_PRIVILEGE_RANK: Record<string, number> = {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  manager: 60,
  employeel2: 50,
  employeel1: 40,
  employeel0: 30,
  employee: 30, // Legacy fallback: bare "Employee" treated as Employee L0
  client: 20,
  viewer: 10,
}
