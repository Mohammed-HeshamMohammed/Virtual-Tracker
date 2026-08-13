/** Mirrors Backend `ROLE_PRIVILEGE_RANK` in relation-sync.js */
export const ROLE_PRIVILEGE_RANK: Record<string, number> = {
  owner: 100,
  superadmin: 90,
  admin: 80,
  supermanager: 70,
  manager: 60,
  teamlead: 50,
  employee: 40,
  intern: 30,
  client: 20,
  viewer: 10,
}
