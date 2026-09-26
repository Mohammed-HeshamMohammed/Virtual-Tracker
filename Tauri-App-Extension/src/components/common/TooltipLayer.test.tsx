import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipLayer } from "./TooltipLayer";
import { isHelpMode, setHelpMode } from "../../utils/helpMode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let target: HTMLButtonElement;

const tip = () => document.querySelector('[role="tooltip"]');
const over = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<TooltipLayer />));
  target = document.createElement("button");
  target.setAttribute("data-tip", "Start the timer");
  target.textContent = "Start";
  document.body.appendChild(target);
});

afterEach(() => {
  act(() => setHelpMode(false));
  act(() => root.unmount());
  container.remove();
  target.remove();
  vi.useRealTimers();
});

describe("TooltipLayer", () => {
  it("shows after a short delay, not instantly", () => {
    over(target);
    expect(tip()).toBeNull();
    wait(200);
    expect(tip()).toBeNull();
    wait(200);
    expect(tip()?.textContent).toBe("Start the timer");
  });

  it("disappears when the pointer moves onto something with no tip", () => {
    over(target);
    wait(400);
    over(document.body);
    expect(tip()).toBeNull();
  });

  it("never appears if the pointer leaves before the delay", () => {
    over(target);
    wait(100);
    over(document.body);
    wait(500);
    expect(tip()).toBeNull();
  });

  it("goes away on Escape and on pressing the button", () => {
    over(target);
    wait(400);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(tip()).toBeNull();

    over(document.body);
    over(target);
    wait(400);
    act(() => void target.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(tip()).toBeNull();
  });

  it("works on a child of the tipped element", () => {
    const icon = document.createElement("span");
    target.appendChild(icon);
    over(icon);
    wait(400);
    expect(tip()?.textContent).toBe("Start the timer");
  });

  it("uses a plain title too, and takes it over", () => {
    const plain = document.createElement("button");
    plain.setAttribute("title", "Refresh");
    document.body.appendChild(plain);
    over(plain);
    wait(400);
    expect(tip()?.textContent).toBe("Refresh");
    expect(plain.hasAttribute("title")).toBe(false);
    plain.remove();
  });

  it("stays quiet for an element with no tip", () => {
    const bare = document.createElement("button");
    document.body.appendChild(bare);
    over(bare);
    wait(500);
    expect(tip()).toBeNull();
    bare.remove();
  });

  it("does not show for an element that was removed while waiting", () => {
    over(target);
    target.remove();
    wait(500);
    expect(tip()).toBeNull();
    document.body.appendChild(target);
  });
});

describe("help mode", () => {
  const region = () => {
    const el = document.createElement("section");
    el.setAttribute("data-help", "Your projects. Pick one to see its tasks.");
    document.body.appendChild(el);
    return el;
  };
  const click = (el: Element) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => void el.dispatchEvent(event));
    return event;
  };

  it("explains a region that has no tooltip of its own, and only in help mode", () => {
    const el = region();
    over(el);
    wait(500);
    expect(tip()).toBeNull();

    over(document.body);
    act(() => setHelpMode(true));
    over(el);
    wait(150);
    expect(tip()?.textContent).toBe("Your projects. Pick one to see its tasks.");
    el.remove();
  });

  it("prefers the longer explanation over the short tooltip", () => {
    target.setAttribute("data-help", "Starts the timer on the task you selected.");
    act(() => setHelpMode(true));
    over(target);
    wait(150);
    expect(tip()?.textContent).toBe("Starts the timer on the task you selected.");
  });

  it("lights up what it explains and points at it, as a coach-mark", () => {
    act(() => setHelpMode(true));
    over(target);
    wait(150);
    expect(document.querySelector(".vt-spotlight")).not.toBeNull();
    expect(tip()?.className).toContain("is-help");
    expect(tip()?.className).toMatch(/is-(below|above)/);
    expect((tip() as HTMLElement).style.getPropertyValue("--arrow-x")).toMatch(/px$/);
  });

  it("a normal tooltip has an arrow but does not dim the page", () => {
    over(target);
    wait(400);
    expect(document.querySelector(".vt-spotlight")).toBeNull();
    expect(tip()?.className).not.toContain("is-help");
    expect(tip()?.className).toMatch(/is-(below|above)/);
  });

  it("the highlight goes away with the tip", () => {
    act(() => setHelpMode(true));
    over(target);
    wait(150);
    over(document.body);
    expect(document.querySelector(".vt-spotlight")).toBeNull();
  });

  it("answers quicker than a normal tooltip", () => {
    act(() => setHelpMode(true));
    over(target);
    wait(150);
    expect(tip()).not.toBeNull();
  });

  it("shows a note that says how to leave", () => {
    expect(document.querySelector(".help-mode-pill")).toBeNull();
    act(() => setHelpMode(true));
    expect(document.querySelector(".help-mode-pill")?.textContent).toMatch(/\? button/);
  });

  it("stops clicks doing anything while it is on, except on the help button", () => {
    let acted = false;
    target.addEventListener("click", () => (acted = true));
    act(() => setHelpMode(true));
    expect(click(target).defaultPrevented).toBe(true);
    expect(acted).toBe(false);

    const help = document.createElement("div");
    help.className = "titlebar-help";
    const inner = document.createElement("button");
    help.appendChild(inner);
    document.body.appendChild(help);
    expect(click(inner).defaultPrevented).toBe(false);
    help.remove();
  });

  it("lets clicks through again once it is off", () => {
    let acted = false;
    target.addEventListener("click", () => (acted = true));
    act(() => setHelpMode(true));
    act(() => setHelpMode(false));
    click(target);
    expect(acted).toBe(true);
  });

  it("Escape hides the tip on screen but does not leave help mode, and the next hover shows one again", () => {
    act(() => setHelpMode(true));
    over(target);
    wait(150);
    expect(tip()).not.toBeNull();

    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(tip()).toBeNull();
    expect(isHelpMode()).toBe(true);
    expect(document.querySelector(".help-mode-pill")).not.toBeNull();

    over(document.body);
    over(target);
    wait(150);
    expect(tip()).not.toBeNull();
  });
});
