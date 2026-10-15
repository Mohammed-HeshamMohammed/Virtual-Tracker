import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MiniTimer } from "./MiniTimer";

const noop = () => {};

function render(tracking: boolean) {
  return renderToStaticMarkup(
    <MiniTimer
      seconds={1176}
      label={tracking ? "Elapsed · Tracking" : "Not tracking"}
      onExit={noop}
      controls={{
        tracking,
        paused: false,
        busy: false,
        canStart: true,
        onStart: noop,
        onPause: noop,
        onStartBreak: noop,
        onResume: noop,
        onStop: noop,
      }}
    />,
  );
}

describe("MiniTimer", () => {
  it("shows the clock, its label and the session buttons", () => {
    const html = render(true);
    expect(html).toContain("00:19:36");
    expect(html).toContain("Elapsed · Tracking");
    expect(html).toContain('aria-label="Pause tracking"');
    expect(html).toContain('aria-label="Stop tracking"');
  });

  it("always has the way back to the full tracker", () => {
    expect(render(false)).toContain('aria-label="Back to the full tracker"');
  });

  it("can be dragged by its body", () => {
    expect(render(true)).toContain('class="mini-timer" data-tauri-drag-region');
  });
});
