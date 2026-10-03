// The project form shows the same budget period the server counts.
import test from "node:test"
import assert from "node:assert/strict"
import { budgetPeriodWindow } from "../features/projects/utils/budget-period.ts"

const pick = (r) => ({ fromDay: r.fromDay, toDay: r.toDay })

test("matches the server's rule for monthly, weekly and never", () => {
  assert.deepEqual(pick(budgetPeriodWindow({ resets: "Monthly", startDate: "2026-01-15" }, "2026-02-20")), {
    fromDay: "2026-02-15",
    toDay: "2026-03-14",
  })
  assert.deepEqual(pick(budgetPeriodWindow({ resets: "Weekly", startDate: "2026-01-07" }, "2026-01-14")), {
    fromDay: "2026-01-14",
    toDay: "2026-01-20",
  })
  assert.deepEqual(pick(budgetPeriodWindow({ resets: "Never", startDate: "2026-01-10" }, "2026-02-01")), {
    fromDay: "2026-01-10",
    toDay: null,
  })
})

test("an end day caps the period, and a future start has not begun", () => {
  assert.equal(budgetPeriodWindow({ resets: "Monthly", startDate: "2026-01-15", endDate: "2026-03-01" }, "2026-02-20").toDay, "2026-03-01")
  assert.equal(budgetPeriodWindow({ resets: "Monthly", startDate: "2026-05-10" }, "2026-04-01").notStarted, true)
})
