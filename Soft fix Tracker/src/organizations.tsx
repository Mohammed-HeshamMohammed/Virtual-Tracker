import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Organizations. A person can belong to several, and each one is a workspace of its own: its projects,
 *  tasks, people, time, Lounge and Dashboard records are separate from every other's. How the app looks
 *  and behaves for this person (theme, motion, audio, window mode) is shared by all of them.
 *
 *  Everything an organization owns is kept under its own prefix in local storage. The first organization
 *  is the one that always existed, so it keeps the original keys (nothing to migrate) and also holds the
 *  sample data; a new organization starts with a small starter project. */

export type Organization = {
  id: string;
  name: string;
  createdAt: string;
  /** Who made it, to start its profile and people list (the maker is its owner). */
  owner?: { name: string; email: string; title: string; status: string };
};
type Registry = { active: string; orgs: Organization[] };

export const MAIN_ORG = "main";
const PREFIX = "softfix.ui.v2.";
const REGISTRY = "softfix.orgs.v1";
/** Kept once for the person, whichever organization is open. */
const SHARED_KEYS = new Set(["preferences", "view-mode", "audio-preferences"]);

function readRegistry(): Registry {
  try {
    const stored = JSON.parse(localStorage.getItem(REGISTRY) ?? "null");
    if (stored && Array.isArray(stored.orgs) && stored.orgs.length && stored.orgs.every((org: Organization) => typeof org?.id === "string" && typeof org?.name === "string")) {
      const active = stored.orgs.some((org: Organization) => org.id === stored.active) ? stored.active : stored.orgs[0].id;
      return { active, orgs: stored.orgs };
    }
  } catch {
    /* fall through to the default */
  }
  // The first time: one organization, named after the workspace name the app used to keep in settings.
  let name = "Soft Fix studio";
  try {
    const legacy = JSON.parse(localStorage.getItem(`${PREFIX}preferences`) ?? "null")?.workspaceName;
    if (typeof legacy === "string" && legacy.trim()) name = legacy.trim();
  } catch {
    /* keep the default name */
  }
  return { active: MAIN_ORG, orgs: [{ id: MAIN_ORG, name, createdAt: new Date().toISOString() }] };
}

// Read once, before anything renders: every persisted hook asks which organization is open.
let registry = readRegistry();
const save = () => {
  try {
    localStorage.setItem(REGISTRY, JSON.stringify(registry));
  } catch {
    /* storage unavailable: the change lasts until the page is closed */
  }
};
save();

export const activeOrg = () => registry.orgs.find((org) => org.id === registry.active) ?? registry.orgs[0];
/** The first organization holds the sample data; the others start nearly empty. */
export const isSampleOrg = () => registry.active === MAIN_ORG;
const prefixOf = (orgId: string) => (orgId === MAIN_ORG ? PREFIX : `${PREFIX}org.${orgId}.`);

/** The local-storage key for something an organization (by default the open one) keeps. */
export const storageKeyFor = (key: string, orgId = registry.active) => (SHARED_KEYS.has(key) ? PREFIX + key : prefixOf(orgId) + key);

/** Whether a full local-storage key is shared or belongs to the open organization (for exports). */
export function isOpenOrgKey(fullKey: string) {
  if (!fullKey.startsWith(PREFIX)) return false;
  const rest = fullKey.slice(PREFIX.length);
  if (rest.startsWith("org.")) return rest.startsWith(`org.${registry.active}.`);
  return registry.active === MAIN_ORG || SHARED_KEYS.has(rest);
}

/** A glance at an organization that isn't open: the person's role in it and how many people it has. */
export function peekOrg(orgId: string) {
  const read = (key: string) => {
    try {
      return JSON.parse(localStorage.getItem(storageKeyFor(key, orgId)) ?? "null");
    } catch {
      return null;
    }
  };
  const profile = read("profile");
  const members = read("members");
  return {
    role: typeof profile?.role === "string" ? profile.role : "Owner",
    people: Array.isArray(members) ? members.length : orgId === MAIN_ORG ? 6 : 1,
  };
}

type OrganizationsValue = {
  orgs: Organization[];
  active: Organization;
  switchTo: (id: string) => void;
  /** Makes an organization and opens it. Returns a message when the name can't be used. */
  create: (name: string, owner: Organization["owner"]) => string | null;
  rename: (id: string, name: string) => string | null;
  remove: (id: string) => void;
};
const OrganizationsContext = createContext<OrganizationsValue | null>(null);

const checkName = (name: string, id?: string) => {
  const clean = name.trim();
  if (!clean) return "Give the organization a name.";
  if (clean.length > 40) return "Keep the name to 40 characters.";
  if (registry.orgs.some((org) => org.id !== id && org.name.toLowerCase() === clean.toLowerCase())) return "You already have an organization with that name.";
  return null;
};

export function OrganizationsProvider({ children }: { children: ReactNode }) {
  const [, refresh] = useState(0);
  const touch = useCallback(() => {
    save();
    refresh((count) => count + 1);
  }, []);

  const value = useMemo<OrganizationsValue>(
    () => ({
      orgs: registry.orgs,
      active: activeOrg(),
      switchTo: (id) => {
        if (id === registry.active || !registry.orgs.some((org) => org.id === id)) return;
        registry = { ...registry, active: id };
        touch();
      },
      create: (name, owner) => {
        const problem = checkName(name);
        if (problem) return problem;
        const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "org";
        const org: Organization = { id: `${slug}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), createdAt: new Date().toISOString(), owner };
        registry = { active: org.id, orgs: [...registry.orgs, org] };
        touch();
        return null;
      },
      rename: (id, name) => {
        const problem = checkName(name, id);
        if (problem) return problem;
        registry = { ...registry, orgs: registry.orgs.map((org) => (org.id === id ? { ...org, name: name.trim() } : org)) };
        touch();
        return null;
      },
      remove: (id) => {
        // The first organization and the open one stay; the rest can be deleted with everything in them.
        if (id === MAIN_ORG || id === registry.active) return;
        const prefix = prefixOf(id);
        for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
        registry = { ...registry, orgs: registry.orgs.filter((org) => org.id !== id) };
        touch();
      },
    }),
    // `touch` re-renders; the registry itself is read fresh each time `refresh` runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [touch, registry],
  );
  return <OrganizationsContext.Provider value={value}>{children}</OrganizationsContext.Provider>;
}

export function useOrganizations() {
  const context = useContext(OrganizationsContext);
  if (!context) throw new Error("OrganizationsProvider is required");
  return context;
}
