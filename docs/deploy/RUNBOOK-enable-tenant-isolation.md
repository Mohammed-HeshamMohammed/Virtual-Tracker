# Runbook — turning on tenant isolation

**Do this before creating the first customer account.** `createCustomerTenant`
refuses to run until the checks below pass, because that one action is what
turns a dormant configuration problem into one organization reading another's
data.

## Why it is off today

Three separate things have to be true before Postgres actually filters rows by
tenant. Today only the first is even attempted:

1. **The policies exist.** `ensure-tenancy-rls.js` creates them on every boot,
   but only when `POSTGRES_TENANCY_RLS_ENABLED=true`. Default: off.
2. **The policies apply to the app's connection.** They are created with
   `FORCE ROW LEVEL SECURITY`, which covers the table owner — but *no* policy
   applies to a **superuser** or a role holding `BYPASSRLS`. A default hosted
   Postgres hands you the `postgres` superuser, and that is almost certainly
   what `POSTGRES_URL` points at right now.
3. **Something proves it.** A policy that exists and a policy that filters are
   different things, and nothing visible distinguishes them — queries return
   rows either way, and every test passes either way.

This is why the app now probes instead of trusting the flag: it sets
`app.tenant_id` to a tenant that does not exist and counts the rows it can
still see. Anything above zero means nothing is being filtered.

## Checking where you stand

```bash
curl -s -H "Cookie: <owner session>" https://<api-host>/api/customer-accounts/isolation
```

Owner-only, deliberately — "this database does not isolate tenants" is not a
sentence to serve to an unauthenticated caller. The boot log carries the same
verdict under `[tenancy]`.

`status` is one of:

| status | meaning |
|---|---|
| `enforced` | The probe could not see another tenant's rows. This is the only passing state. |
| `not-enforced` | At least one concrete reason is listed. Fix them in order. |
| `unknown` | The probe could not run, or `members` is empty so zero visible rows proves nothing. |

## Turning it on

### 1. Create the role and let the migration build the policies

Set `POSTGRES_TENANCY_RLS_ENABLED=true` and restart once. `ensureTenancyRls()`
creates `vt_app`, `vt_readonly_crosstenant` and `vt_admin`, then enables and
FORCEs row security on every table in `TENANT_SCOPED_TABLES`.

Nothing changes behaviourally yet — the app is still connecting as a role that
bypasses all of it. That is the point of doing this step on its own.

### 2. Give `vt_app` a password

The migration creates the role with `PASSWORD NULL`, which cannot log in:

```sql
ALTER ROLE vt_app LOGIN PASSWORD '<generated>';
```

### 3. Point the app at it

Change `POSTGRES_URL` to connect as `vt_app` instead of the superuser, and
restart.

**This is the step that actually changes anything**, and the one to be ready to
roll back. Keep the previous `POSTGRES_URL` to hand.

### 4. Confirm

Re-check the endpoint. It must now read `enforced`. If it does not, the
`reasons` array names what is still wrong.

## Known consequence: cross-tenant writes

Everything in `customer-accounts/tenant.service.js` is a cross-tenant write by
nature — an Owner in the main tenant creating rows that belong to a brand-new
customer tenant. `vt_app`'s `WITH CHECK` clause is designed to reject exactly
that mismatch.

So step 3 is not complete until those calls run on a **`vt_admin`** connection
(`BYPASSRLS`) rather than `vt_app`. `client.js` exposes one pool for the whole
app today, so that split is real work, not configuration. The file header in
`tenant.service.js` has carried this note since the tenancy work landed.

**Order of operations:** do the pool split *before* step 3, or the first thing
that breaks after the cutover is the ability to create customer accounts at all.

## Rolling back

Revert `POSTGRES_URL` to the previous role and restart. The policies stay in
place and go back to being inert — the same state as before step 3.

Do **not** roll back by dropping the policies once a customer tenant exists:
that removes isolation from live multi-tenant data, which is the failure this
whole mechanism is here to prevent.

## The escape hatch

`ALLOW_UNISOLATED_CUSTOMER_TENANTS=true` bypasses the guard and lets a customer
tenant be created anyway. It exists so that accepting the risk is a documented,
greppable decision rather than someone quietly deleting the check.

Setting it means accepting that one customer organization can read another's
data. There is no configuration in which that is a good idea; it is here for an
operator who needs to ship before the pool split lands and knows exactly what
they are trading away.
