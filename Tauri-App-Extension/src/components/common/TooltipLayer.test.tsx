import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipLayer } from "./TooltipLayer";
import { setHelpMode } from "../../utils/helpMode";

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

describe("while the guided tour is running", () => {
  it("normal tooltips stay quiet", () => {
    act(() => setHelpMode(true));
    over(target);
    wait(500);
    expect(tip()).toBeNull();
  });

  it("and come back when it ends", () => {
    act(() => setHelpMode(true));
    act(() => setHelpMode(false));
    over(target);
    wait(400);
    expect(tip()?.textContent).toBe("Start the timer");
  });
});
