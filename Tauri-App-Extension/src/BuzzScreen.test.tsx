import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { BuzzView } from "./BuzzScreen";

const noop = () => {};

describe("BuzzView", () => {
  it("draws the joke blue screen with the message, who sent it, and how to close it", () => {
    const html = renderToStaticMarkup(
      <BuzzView buzz={{ style: "bluescreen", message: "Dude. Focus on work.", from: "Olive Owner" }} onClose={noop} />,
    );
    expect(html).toContain("buzz-bsod");
    expect(html).toContain("Dude. Focus on work.");
    expect(html).toContain("Olive Owner");
    expect(html).toContain("Just kidding");
    expect(html).toContain("Click anywhere or press any key");
  });

  it("draws the nudge as a card that is itself the close button", () => {
    const html = renderToStaticMarkup(
      <BuzzView buzz={{ style: "nudge", message: "Back to it", from: "Olive Owner" }} onClose={noop} />,
    );
    expect(html).toContain("buzz-nudge");
    expect(html).toContain("Buzz from Olive Owner");
    expect(html).toContain("Back to it");
    expect(html).not.toContain("buzz-bsod");
  });

  it("uses the tracker's own heading for its notices, such as a break ending", () => {
    const html = renderToStaticMarkup(
      <BuzzView buzz={{ style: "nudge", message: "Your timer is running again.", from: "", title: "Break is over" }} onClose={noop} />,
    );
    expect(html).toContain("Break is over");
    expect(html).not.toContain("Buzz from");
  });
});

describe("BuzzView timing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const show = (sticky: boolean) => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        <BuzzView
          buzz={{ style: "nudge", message: "Timer stopped — no mouse or keyboard for 8 min", from: "", title: "Your timer stopped", sticky }}
          onClose={onClose}
        />,
      ),
    );
    return onClose;
  };

  it("an ordinary notice closes itself after a few seconds", () => {
    const onClose = show(false);
    act(() => vi.advanceTimersByTime(9_000));
    expect(onClose).toHaveBeenCalled();
  });

  it("a timer-stopped notice stays until its Close button is pressed - not on a timer, not on a key", () => {
    const onClose = show(true);
    act(() => vi.advanceTimersByTime(10 * 60_000));
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));
    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain("no mouse or keyboard for 8 min");

    const close = [...container.querySelectorAll("button")].find((b) => b.textContent === "Close");
    act(() => void close!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
