import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekChart, todayIndexFor } from "./WeekChart";
import type { WeeklyActivityDay } from "../../types";

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const week = (hours: [number, number][]): WeeklyActivityDay[] =>
  LABELS.map((label, i) => ({
    key: label.toLowerCase(),
    label,
    activeHours: hours[i]?.[0] ?? 0,
    idleHours: hours[i]?.[1] ?? 0,
  }));

// Wednesday 16 September 2026, midday UTC.
const WEDNESDAY = Date.UTC(2026, 8, 16, 12, 0, 0);

describe("WeekChart", () => {
  it("finds today by its weekday in the page's time zone", () => {
    expect(todayIndexFor(week([]), WEDNESDAY, "UTC")).toBe(2);
    // Already Thursday east of the date line.
    expect(todayIndexFor(week([]), Date.UTC(2026, 8, 16, 20, 0, 0), "Pacific/Auckland")).toBe(3);
  });

  it("falls back to the local zone rather than throwing on a bad one", () => {
    expect(todayIndexFor(week([]), WEDNESDAY, "Not/AZone")).toBeGreaterThanOrEqual(0);
  });

  it("draws a bar per day, scaled to the busiest one, and totals the active time", () => {
    const html = renderToStaticMarkup(
      <WeekChart days={week([[4, 0], [2, 0]])} loading={false} now={WEDNESDAY} timeZone="UTC" />,
    );
    expect((html.match(/class="week-chart-day/g) ?? []).length).toBe(7);
    expect(html).toContain("height:100%");
    expect(html).toContain("height:50%");
    expect(html).toContain("6h 0s active");
  });

  it("marks today and dims the days still to come", () => {
    const html = renderToStaticMarkup(
      <WeekChart days={week([[1, 0]])} loading={false} now={WEDNESDAY} timeZone="UTC" />,
    );
    expect(html).toContain("week-chart-day is-today");
    expect((html.match(/is-future/g) ?? []).length).toBe(4);
  });

  it("still lays out the whole week, and says so, before anything is tracked", () => {
    const empty = renderToStaticMarkup(<WeekChart days={[]} loading={false} now={WEDNESDAY} timeZone="UTC" />);
    expect((empty.match(/class="week-chart-day/g) ?? []).length).toBe(7);
    expect(empty).toContain("Nothing tracked this week yet");

    const loading = renderToStaticMarkup(<WeekChart days={[]} loading={true} now={WEDNESDAY} timeZone="UTC" />);
    expect(loading).not.toContain("Nothing tracked this week yet");
  });
});
