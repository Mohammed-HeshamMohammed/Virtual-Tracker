// In-memory stand-ins for the two Firebase Admin surfaces the routes still touch: Auth (sign-in
// accounts) and Firestore (user profiles). Only what the handlers call is implemented; an
// unexpected call throws, so a new dependency shows up as a failing test rather than a silent pass.

export function fakeFirestore() {
  const collections = new Map();
  const docs = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };
  const snap = (name, id) => {
    const data = docs(name).get(id);
    return { id, exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }), ref: ref(name, id) };
  };
  const ref = (name, id) => ({
    id,
    get: async () => snap(name, id),
    set: async (data, opts = {}) => {
      docs(name).set(id, opts.merge ? { ...(docs(name).get(id) ?? {}), ...data } : { ...data });
    },
    update: async (data) => {
      if (!docs(name).has(id)) throw Object.assign(new Error(`no document ${name}/${id}`), { code: 5 });
      docs(name).set(id, { ...docs(name).get(id), ...data });
    },
    delete: async () => {
      docs(name).delete(id);
    },
  });
  const query = (name, filters = [], max = Infinity) => ({
    where: (field, op, value) => {
      if (op !== "==") throw new Error(`fake Firestore: unsupported operator ${op}`);
      return query(name, [...filters, [field, value]], max);
    },
    limit: (n) => query(name, filters, n),
    get: async () => {
      const found = [...docs(name).entries()]
        .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        .slice(0, max)
        .map(([id]) => snap(name, id));
      return { empty: found.length === 0, size: found.length, docs: found, forEach: (fn) => found.forEach(fn) };
    },
  });
  return {
    collection: (name) => ({
      doc: (id) => ref(name, id ?? Math.random().toString(36).slice(2)),
      ...query(name),
    }),
    getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
    /** Test-side view of a collection. */
    dump: (name) => Object.fromEntries(docs(name)),
  };
}

export function fakeAuth() {
  const users = new Map();
  let n = 0;
  const notFound = () => Object.assign(new Error("no user"), { code: "auth/user-not-found" });
  const record = (u) => ({ providerData: [], customClaims: {}, metadata: {}, disabled: false, ...u });
  return {
    users,
    createUser: async ({ email, password, displayName, emailVerified = false }) => {
      if ([...users.values()].some((u) => u.email === email)) {
        throw Object.assign(new Error("exists"), { code: "auth/email-already-exists" });
      }
      const uid = `uid-${++n}`;
      users.set(uid, { uid, email, password, displayName, emailVerified });
      return record(users.get(uid));
    },
    getUser: async (uid) => {
      if (!users.has(uid)) throw notFound();
      return record(users.get(uid));
    },
    getUserByEmail: async (email) => {
      const u = [...users.values()].find((x) => x.email === email);
      if (!u) throw notFound();
      return record(u);
    },
    updateUser: async (uid, patch) => {
      if (!users.has(uid)) throw notFound();
      users.set(uid, { ...users.get(uid), ...patch });
      return record(users.get(uid));
    },
    setCustomUserClaims: async () => {},
    revokeRefreshTokens: async () => {},
    deleteUser: async (uid) => {
      users.delete(uid);
    },
  };
}
