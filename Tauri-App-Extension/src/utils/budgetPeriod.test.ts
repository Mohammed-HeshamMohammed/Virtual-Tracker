import { describe, expect, it } from "vitest";
import { budgetResetNote } from "./budgetPeriod";
import type { ProjectBudgetStatus } from "../types";

const status = (over: Partial<ProjectBudgetStatus>): ProjectBudgetStatus => ({
  scope: "shared",
  capSeconds: 36000,
  spentSeconds: 18000,
  remainingSeconds: 18000,
  ...over,
});

describe("budgetResetNote", () => {
  it("says nothing for a budget that never resets, or an older server that does not say", () => {
    expect(budgetResetNote(null)).toBeNull();
    expect(budgetResetNote(status({}))).toBeNull();
    expect(budgetResetNote(status({ resets: "never", periodEnd: null }))).toBeNull();
  });

  it("names the day the next period starts - the day after this one ends", () => {
    expect(budgetResetNote(status({ resets: "monthly", periodStart: "2026-10-15", periodEnd: "2026-11-14" }))).toBe("Resets Nov 15");
    expect(budgetResetNote(status({ resets: "weekly", periodEnd: "2026-12-31" }))).toBe("Resets Jan 1");
    expect(budgetResetNote(status({ resets: "repeat", periodEnd: "2026-02-28" }))).toBe("Resets Mar 1");
  });

  it("says nothing for a periodic budget whose end is unknown", () => {
    expect(budgetResetNote(status({ resets: "monthly", periodEnd: null }))).toBeNull();
  });

  it("explains a budget that starts over once it is used up", () => {
    expect(budgetResetNote(status({ resets: "usedup" }))).toBe("Starts over once it's used up");
    expect(budgetResetNote(status({ resets: "usedup", remainingSeconds: 0, spentSeconds: 36000 }))).toBe(
      "Used up - starts over tomorrow",
    );
  });
});
