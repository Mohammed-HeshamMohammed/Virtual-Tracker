/**
 * Runs schema statements in order, retrying the ones that fail until a pass
 * makes no further progress.
 *
 * The schema is one long ordered list in which some statements read tables a
 * later statement creates - a view over pay_rates before pay_rates exists, a
 * foreign key to a table defined further down. On a database that already has
 * everything that never shows, because the tables are there from an earlier
 * boot. On an empty one the loop used to stop at the first such statement and
 * throw, leaving everything after it uncreated.
 *
 * A statement that is genuinely wrong still fails: it fails on every pass, the
 * last pass makes no progress, and it is reported. Nothing is swallowed - the
 * only thing that changes is that one bad statement no longer blocks the
 * hundreds that do not depend on it.
 */
export async function applyStatementsWithRetry(client, statements) {
  let pending = [...statements];
  let failures = [];

  while (pending.length) {
    failures = [];
    for (const statement of pending) {
      try {
        await client.query(statement);
      } catch (error) {
        failures.push({ statement, error });
      }
    }
    if (failures.length === 0) return [];
    // No statement got through this pass, so another pass cannot help.
    if (failures.length === pending.length) break;
    pending = failures.map((f) => f.statement);
  }
  return failures;
}

export function describeFailures(failures) {
  if (!failures.length) return "";
  const first = failures[0];
  const sql = String(first.statement).replace(/\s+/g, " ").slice(0, 120);
  const message = first.error instanceof Error ? first.error.message : String(first.error);
  const more = failures.length > 1 ? ` (+${failures.length - 1} more)` : "";
  return `${message} - in: ${sql}${more}`;
}
