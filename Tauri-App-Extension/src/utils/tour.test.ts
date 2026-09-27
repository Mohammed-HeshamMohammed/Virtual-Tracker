import { describe, expect, it } from "vitest";
import { orderForTour, rankOf, TOUR_REGIONS } from "./tour";

const item = (rank: number, order: number, group = `g${order}`) => ({ rank, order, group, id: `${rank}.${order}` });

describe("orderForTour", () => {
  it("visits the sidebar first, then the top bar, then the page, whatever the page order", () => {
    const shuffled = [item(2, 1), item(1, 2), item(0, 3), item(3, 4), item(2, 5)];
    expect(orderForTour(shuffled).map((i) => i.rank)).toEqual([0, 1, 2, 2, 3]);
  });

  it("goes top to bottom inside a region", () => {
    const list = [item(0, 9), item(0, 2), item(0, 5)];
    expect(orderForTour(list).map((i) => i.order)).toEqual([2, 5, 9]);
  });

  it("shows only the first of a long run of look-alikes", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => item(0, n, "task-rows"));
    expect(orderForTour(rows).map((i) => i.order)).toEqual([1]);
  });

  it("shows a short run in full", () => {
    const rows = [1, 2].map((n) => item(0, n, "pair"));
    expect(orderForTour(rows)).toHaveLength(2);
  });

  it("can show more than one of a run", () => {
    const rows = [1, 2, 3, 4].map((n) => item(0, n, "rows"));
    expect(orderForTour(rows, 2).map((i) => i.order)).toEqual([1, 2]);
  });

  it("does not change what it is given", () => {
    const input = [item(1, 2), item(0, 1)];
    orderForTour(input);
    expect(input.map((i) => i.rank)).toEqual([1, 0]);
  });
});

describe("rankOf", () => {
  const within = (matching: string) => ({ closest: (selector: string) => (selector === matching ? {} : null) });

  it("ranks by the first region that holds the element", () => {
    expect(rankOf(within(".side-panel"))).toBe(0);
    expect(rankOf(within(".titlebar"))).toBe(1);
    expect(rankOf(within(".page-area"))).toBe(2);
    expect(rankOf(within(".side-column, .tasks-column"))).toBe(3);
  });

  it("puts anything outside every region last", () => {
    expect(rankOf({ closest: () => null })).toBe(TOUR_REGIONS.length);
  });
});
