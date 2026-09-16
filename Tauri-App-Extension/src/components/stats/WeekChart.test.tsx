import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekChart } from "./WeekChart";
import type { WeekDay } from "../../types";

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const week = (seconds: [number, number][]): WeekDay[] =>
  LABELS.map((label, i) => ({
    day: `2026-09-${String(14 + i).padStart(2, "0")}`,
    label,
    activeSeconds: seconds[i]?.[0] ?? 0,
    idleSeconds: seconds[i]?.[1] ?? 0,
  }));

describe("WeekChart", () => {
  it("draws a bar per day, scaled to the busiest one, and totals the active time", () => {
    const html = renderToStaticMarkup(
      <WeekChart days={week([[4 * 3600, 0], [2 * 3600, 0]])} todayDay="2026-09-16" loading={false} />,
    );
    expect((html.match(/class="week-chart-day/g) ?? []).length).toBe(7);
    expect(html).toContain("height:100%");
    expect(html).toContain("height:50%");
    expect(html).toContain("6h 0s active");
  });

  it("keeps short stretches instead of rounding them away", () => {
    // The old chart rounded to tenths of an hour, so anything under ~3 minutes
    // drew nothing at all.
    const html = renderToStaticMarkup(
      <WeekChart days={week([[95, 0]])} todayDay="2026-09-14" loading={false} />,
    );
    expect(html).toContain("1m 35s");
    expect(html).not.toContain("Nothing tracked this week yet");
  });

  it("marks the server's today and dims the days still to come", () => {
    const html = renderToStaticMarkup(
      <WeekChart days={week([[60, 0]])} todayDay="2026-09-16" loading={false} />,
    );
    expect(html).toContain("week-chart-day is-today");
    expect((html.match(/is-future/g) ?? []).length).toBe(4);
  });

  it("still lays out the whole week, and says so, before anything is tracked", () => {
    const empty = renderToStaticMarkup(<WeekChart days={[]} todayDay="" loading={false} />);
    expect((empty.match(/class="week-chart-day/g) ?? []).length).toBe(7);
    expect(empty).toContain("Nothing tracked this week yet");
    expect(empty).not.toContain("is-today");

    const loading = renderToStaticMarkup(<WeekChart days={[]} todayDay="" loading={true} />);
    expect(loading).not.toContain("Nothing tracked this week yet");
  });
});
