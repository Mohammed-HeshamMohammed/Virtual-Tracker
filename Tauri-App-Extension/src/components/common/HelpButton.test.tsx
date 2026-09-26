import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HelpButton } from "./HelpButton";
import { isHelpMode, setHelpMode } from "../../utils/helpMode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const button = () => container.querySelector('button[aria-label="Help"]') as HTMLButtonElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<HelpButton />));
});

afterEach(() => {
  act(() => setHelpMode(false));
  act(() => root.unmount());
  container.remove();
});

describe("HelpButton", () => {
  it("turns help mode on when pressed and off when pressed again", () => {
    expect(isHelpMode()).toBe(false);
    act(() => void button().click());
    expect(isHelpMode()).toBe(true);
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.classList.contains("help-mode")).toBe(true);
    act(() => void button().click());
    expect(isHelpMode()).toBe(false);
    expect(document.documentElement.classList.contains("help-mode")).toBe(false);
  });

  it("says what pressing it will do", () => {
    expect(button().getAttribute("data-tip")).toMatch(/^Help/);
    act(() => void button().click());
    expect(button().getAttribute("data-tip")).toBe("Leave help mode");
  });
});
