import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RestartNoticeBanner, formatStoppedAt } from "./RestartNoticeBanner";

const noop = () => {};
const at = new Date(2026, 10, 10, 14, 5).getTime();

describe("RestartNoticeBanner", () => {
  it("says when the timer stopped and offers to start the same task again", () => {
    const html = renderToStaticMarkup(
      <RestartNoticeBanner notice={{ stoppedAtMs: at, taskId: "task-1", projectId: null }} onStartAgain={noop} onDismiss={noop} />,
    );
    expect(html).toContain("Your timer stopped at");
    expect(html).toContain(formatStoppedAt(at));
    expect(html).toContain("Start again");
    expect(html).toContain("Dismiss");
  });

  it("offers to start a task-less project session too", () => {
    const html = renderToStaticMarkup(
      <RestartNoticeBanner notice={{ stoppedAtMs: at, taskId: null, projectId: "proj-1" }} onStartAgain={noop} onDismiss={noop} />,
    );
    expect(html).toContain("Start again");
  });

  it("has no Start button when it is not known what was running", () => {
    const html = renderToStaticMarkup(
      <RestartNoticeBanner notice={{ stoppedAtMs: at, taskId: null, projectId: null }} onStartAgain={noop} onDismiss={noop} />,
    );
    expect(html).not.toContain("Start again");
    expect(html).toContain("Dismiss");
  });

  it("leaves the time out rather than inventing one", () => {
    expect(formatStoppedAt(0)).toBe("");
    const html = renderToStaticMarkup(
      <RestartNoticeBanner notice={{ stoppedAtMs: 0, taskId: "t", projectId: null }} onStartAgain={noop} onDismiss={noop} />,
    );
    expect(html).toContain("Your timer stopped</strong>");
  });

  it("shows a busy label and disables the buttons while starting", () => {
    const html = renderToStaticMarkup(
      <RestartNoticeBanner notice={{ stoppedAtMs: at, taskId: "t", projectId: null }} busy onStartAgain={noop} onDismiss={noop} />,
    );
    expect(html).toContain("Starting…");
    expect(html).toContain("disabled");
  });
});
