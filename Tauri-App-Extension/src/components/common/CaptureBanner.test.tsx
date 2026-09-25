import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CaptureBanner } from "./CaptureBanner";

const noop = () => {};
const render = (status: Parameters<typeof CaptureBanner>[0]["status"], busy = false) =>
  renderToStaticMarkup(<CaptureBanner status={status} busy={busy} onEndBreak={noop} onOpenPrivacy={noop} />);

describe("CaptureBanner", () => {
  it("renders nothing while capture is on, so it costs the normal case nothing", () => {
    expect(render({ blocked: false, reason: "", breakUntilMs: 0 })).toBe("");
  });

  it("says a break is running, how long is left, and offers to end it", () => {
    const html = render({
      blocked: true,
      reason: "Private break - nothing is being captured.",
      breakUntilMs: Date.now() + 12 * 60_000,
    });
    expect(html).toContain("Private break");
    expect(html).toMatch(/1[12] min left/);
    expect(html).toContain("End break");
  });

  it("explains being outside work hours and points at Privacy instead of offering to end anything", () => {
    const html = render({
      blocked: true,
      reason: "Outside your work hours - nothing is being captured.",
      breakUntilMs: 0,
    });
    expect(html).toContain("Not capturing");
    expect(html).toContain("Outside your work hours");
    expect(html).not.toContain("End break");
    expect(html).toContain("Privacy");
  });

  it("disables End break while it is being ended, so it cannot be sent twice", () => {
    const html = render(
      { blocked: true, reason: "Private break", breakUntilMs: Date.now() + 5 * 60_000 },
      true,
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>End break/);
  });

  it("treats a break whose time has already passed as over, not as still running", () => {
    const html = render({ blocked: true, reason: "Outside your work hours", breakUntilMs: Date.now() - 1000 });
    expect(html).not.toContain("End break");
  });
});
