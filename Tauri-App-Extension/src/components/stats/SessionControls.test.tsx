import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionControls } from "./SessionControls";

const noop = () => {};

function render(overrides: Partial<Parameters<typeof SessionControls>[0]> = {}) {
  return renderToStaticMarkup(
    <SessionControls
      tracking={false}
      paused={false}
      busy={false}
      canStart={true}
      onStart={noop}
      onPause={noop}
      onResume={noop}
      onStop={noop}
      {...overrides}
    />,
  );
}

describe("SessionControls", () => {
  it("is a green play button with no Stop while nothing is running", () => {
    const html = render();
    expect(html).toContain("session-toggle is-idle");
    expect(html).toContain('aria-label="Start tracking"');
    expect(html).not.toContain("session-stop");
  });

  it("turns into a pause button, with Stop beside it, while tracking", () => {
    const html = render({ tracking: true });
    expect(html).toContain("session-toggle is-tracking");
    expect(html).toContain('aria-label="Pause tracking"');
    expect(html).toContain('aria-label="Stop tracking"');
  });

  it("shows play again on a break, in its own colour, and keeps Stop", () => {
    const html = render({ paused: true });
    expect(html).toContain("session-toggle is-paused");
    expect(html).toContain('aria-label="Resume tracking"');
    expect(html).toContain('aria-label="Stop tracking"');
  });

  it("can't start without a selection, and says why", () => {
    const html = render({ canStart: false, blockedReason: "Pick a task first" });
    expect(html).toMatch(/<button[^>]*session-toggle[^>]*disabled/);
    expect(html).toContain('title="Pick a task first"');
  });

  it("a missing selection never blocks pausing a session that is already running", () => {
    const html = render({ tracking: true, canStart: false });
    expect(html).not.toMatch(/<button[^>]*session-toggle[^>]*disabled/);
  });
});
