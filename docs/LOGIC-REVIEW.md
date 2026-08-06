# Logic Bug Review — Index

Targeted review of the features in [FEATURES.md](FEATURES.md) for real logic defects — wrong conditionals, unit mismatches, race conditions, silent partial writes. Not a security or style pass. Every entry was verified by tracing the full function and its callers, not just the snippet.

17 confirmed bugs, split by area. **Tasks is fully resolved, including a design gap (per-assignee blocking) fixed by building the missing feature rather than deleting what implied it. The other four areas are untouched.**

| Area | File | Confirmed bugs | Status |
|---|---|---|---|
| Billing & Budgets | [LOGIC-REVIEW-billing-budgets.md](dashboard-backend/LOGIC-REVIEW-billing-budgets.md) | 3 (1 critical) | Open |
| Dashboard | [LOGIC-REVIEW-dashboard.md](dashboard-backend/LOGIC-REVIEW-dashboard.md) | 3 | Open |
| Tasks | [LOGIC-REVIEW-tasks.md](dashboard-backend/LOGIC-REVIEW-tasks.md) | 6 (incl. 2 found later) | ✅ All fixed |
| Members & Org Chart | [LOGIC-REVIEW-members-org-chart.md](dashboard-backend/LOGIC-REVIEW-members-org-chart.md) | 4 | Open |
| Auth | [LOGIC-REVIEW-auth.md](auth-backend/LOGIC-REVIEW-auth.md) | 2 | Open |

Note: the "Budget Used always 0%" bug is filed under both Billing & Budgets (root cause) and Dashboard (where it's visible), since it's one defect with two audiences.

## Worst three, if you only fix three things

1. **Auto-invoicing is completely dead for any client with a send-delay configured** — a milliseconds/days unit mix-up (`Billing & Budgets`).
2. **"Total" client budgets get charged in full to every linked project instead of split** — can triple/quadruple a client's actual budget cap across their projects (`Billing & Budgets`).
3. **`/api/v1/auth/*` 404s despite being a documented, frontend-relied-on alias** — two separate files, same root cause: a normalized path variable computed and then never used (`Auth`).

## Areas reviewed with nothing to report

Activity tracking/screenshots, presence, notifications delivery, schema-driven generic CRUD, the landing site, and the internal admin monitor were all reviewed and came back clean — no confirmed logic defects. Specifics on what was checked in each area are noted at the bottom of the relevant per-area file above.
