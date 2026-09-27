import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TourLayer } from "./TourLayer";
import { isHelpMode, setHelpMode } from "../../utils/helpMode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let page: HTMLDivElement;

const callout = () => document.querySelector(".vt-tour .vt-tip");
const text = () => document.querySelector(".vt-tour-text")?.textContent;
const count = () => document.querySelector(".vt-tour-count")?.textContent;
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".vt-tour button")].find((b) => b.textContent === label);
const press = (key: string) => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
const click = (el: Element | undefined) => act(() => void el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
const start = () => act(() => setHelpMode(true));

/** A page in the order the DOM has it, deliberately not the order the tour visits it. */
function buildPage() {
  page = document.createElement("div");
  page.innerHTML = `
    <main class="page-area"><button data-help="Main one">a</button><div data-help="Main two">b</div></main>
    <header class="titlebar"><button data-tip="Bar one">c</button></header>
    <aside class="side-panel"><button data-help="Side one">d</button><button data-tip="Side two">e</button></aside>
    <div data-help="Loose one">f</div>`;
  document.body.appendChild(page);
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 10, left: 10, top: 10, width: 40, height: 20, right: 50, bottom: 30, toJSON: () => ({}) } as DOMRect);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<TourLayer />));
  buildPage();
});

afterEach(() => {
  act(() => setHelpMode(false));
  act(() => root.unmount());
  container.remove();
  page.remove();
  vi.restoreAllMocks();
});

describe("the guided tour", () => {
  it("does nothing until it is started", () => {
    expect(callout()).toBeNull();
  });

  it("starts at the sidebar and goes sidebar, top bar, page, then everything else", () => {
    start();
    const seen: string[] = [];
    for (let i = 0; i < 6 && text(); i++) {
      seen.push(text()!);
      if (button("Next")) click(button("Next"));
    }
    expect(seen).toEqual(["Side one", "Side two", "Bar one", "Main one", "Main two", "Loose one"]);
  });

  it("says where it is in the tour", () => {
    start();
    expect(count()).toBe("1 of 6");
    click(button("Next"));
    expect(count()).toBe("2 of 6");
  });

  it("goes back, and has no Back on the first step", () => {
    start();
    expect(button("Back")).toBeUndefined();
    click(button("Next"));
    click(button("Back"));
    expect(text()).toBe("Side one");
  });

  it("finishes on the last step's Done", () => {
    start();
    for (let i = 0; i < 5; i++) click(button("Next"));
    expect(text()).toBe("Loose one");
    expect(button("Next")).toBeUndefined();
    click(button("Done"));
    expect(isHelpMode()).toBe(false);
    expect(callout()).toBeNull();
  });

  it("lights the current thing and points at it", () => {
    start();
    expect(document.querySelector(".vt-spotlight")).not.toBeNull();
    expect(callout()?.className).toMatch(/is-(below|above)/);
    expect(callout()?.getAttribute("style")).toContain("--arrow-x");
  });

  it("Skip ends it", () => {
    start();
    click(button("Skip tour"));
    expect(isHelpMode()).toBe(false);
    expect(callout()).toBeNull();
  });

  it("Escape ends it", () => {
    start();
    press("Escape");
    expect(isHelpMode()).toBe(false);
    expect(callout()).toBeNull();
  });

  it("the arrow keys move through it", () => {
    start();
    press("ArrowRight");
    expect(text()).toBe("Side two");
    press("ArrowLeft");
    expect(text()).toBe("Side one");
  });

  it("nothing under it can be clicked while it runs, and works again afterwards", () => {
    let acted = 0;
    const target = page.querySelector("button")!;
    target.addEventListener("click", () => acted++);
    start();
    click(target);
    expect(acted).toBe(0);
    click(button("Skip tour"));
    click(target);
    expect(acted).toBe(1);
  });

  it("leaves out its own help button", () => {
    const help = document.createElement("div");
    help.className = "titlebar-help";
    help.innerHTML = '<button data-tip="Help">?</button>';
    page.appendChild(help);
    start();
    expect(count()).toBe("1 of 6");
  });

  it("is only about the dialog when one is open", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.innerHTML = '<input data-help="Name field" /><button data-tip="Save it">s</button>';
    page.appendChild(dialog);
    start();
    expect(count()).toBe("1 of 2");
    expect(text()).toBe("Name field");
  });

  it("shows a long list by its first row only", () => {
    const list = document.createElement("div");
    list.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button data-tour-repeat="rows" data-tip="Row ${n}">r</button>`).join("");
    page.querySelector("aside")!.appendChild(list);
    start();
    expect(count()).toBe("1 of 7");
  });

  it("explains look-alike buttons that are not rows of a list, each in turn", () => {
    const bar = document.createElement("div");
    bar.innerHTML = ["Minimize", "Maximize", "Close"].map((n) => `<button class="win-btn" data-tip="${n}">x</button>`).join("");
    page.querySelector("header")!.appendChild(bar);
    start();
    expect(count()).toBe("1 of 9");
  });

  it("does not start when there is nothing to explain", () => {
    page.remove();
    start();
    expect(isHelpMode()).toBe(false);
  });
});
