# Logic Bug Review — Index

Targeted review of the features in [FEATURES.md](FEATURES.md) for real logic defects — wrong conditionals, unit mismatches, race conditions, silent partial writes. Not a security or style pass. Every entry was verified by tracing the full function and its callers, not just the snippet.

15 confirmed bugs, 1 lower-confidence flag, split by area:

| Area | File | Confirmed bugs |
|---|---|---|
| Billing & Budgets | [LOGIC-REVIEW-billing-budgets.md](LOGIC-REVIEW-billing-budgets.md) | 3 (1 critical) |
| Dashboard | [LOGIC-REVIEW-dashboard.md](LOGIC-REVIEW-dashboard.md) | 3 |
| Tasks | [LOGIC-REVIEW-tasks.md](LOGIC-REVIEW-tasks.md) | 3 confirmed + 1 lower-confidence |
| Members & Org Chart | [LOGIC-REVIEW-members-org-chart.md](LOGIC-REVIEW-members-org-chart.md) | 4 |
| Auth | [LOGIC-REVIEW-auth.md](LOGIC-REVIEW-auth.md) | 2 |

Note: the "Budget Used always 0%" bug is filed under both Billing & Budgets (root cause) and Dashboard (where it's visible), since it's one defect with two audiences.

## Worst three, if you only fix three things

1. **Auto-invoicing is completely dead for any client with a send-delay configured** — a milliseconds/days unit mix-up (`Billing & Budgets`).
2. **"Total" client budgets get charged in full to every linked project instead of split** — can triple/quadruple a client's actual budget cap across their projects (`Billing & Budgets`).
3. **`/api/v1/auth/*` 404s despite being a documented, frontend-relied-on alias** — two separate files, same root cause: a normalized path variable computed and then never used (`Auth`).

## Areas reviewed with nothing to report

Activity tracking/screenshots, presence, notifications delivery, schema-driven generic CRUD, the landing site, and the internal admin monitor were all reviewed and came back clean — no confirmed logic defects. Specifics on what was checked in each area are noted at the bottom of the relevant per-area file above.
