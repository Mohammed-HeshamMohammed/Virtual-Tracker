/**
 * One-time migration: drop deprecated client budget start date fields.
 *
 * Usage:
 *   npm run migrate:client-budget-start-date
 */
import { removeClientBudgetStartDates } from "../src/modules/clients/migrate-remove-budget-start-date.js";

async function main() {
  const result = await removeClientBudgetStartDates();
  if (!result.success) {
    console.error("[migrate:client-budget-start-date] Failed:", result.reason ?? "unknown");
    process.exit(1);
  }
  if (result.alreadyCompleted) {
    console.info("[migrate:client-budget-start-date] Already completed — no changes needed.");
    return;
  }
  console.info(`[migrate:client-budget-start-date] Updated ${result.updated ?? 0} budget document(s).`);
}

main().catch((err) => {
  console.error("[migrate:client-budget-start-date]", err);
  process.exit(1);
});
