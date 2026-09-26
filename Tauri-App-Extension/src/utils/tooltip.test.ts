import { describe, expect, it } from "vitest";
import { placeTip, tipTextOf } from "./tooltip";

const VIEW = { width: 400, height: 300 };
const TIP = { width: 100, height: 30 };
const target = (left: number, top: number, width = 40, height = 20) => ({ left, top, bottom: top + height, width });

describe("placeTip", () => {
  it("sits below the target, centred on it, with its arrow pointing up at the middle", () => {
    expect(placeTip(target(150, 50), TIP, VIEW)).toEqual({ left: 120, top: 82, below: true, arrow: 50 });
  });

  it("flips above when there is no room below", () => {
    expect(placeTip(target(150, 270), TIP, VIEW)).toEqual({ left: 120, top: 228, below: false, arrow: 50 });
  });

  it("is kept inside the window at either edge, and the arrow still points at the target", () => {
    const left = placeTip(target(0, 50, 10), TIP, VIEW);
    expect(left.left).toBe(8);
    expect(left.arrow).toBe(14);
    const right = placeTip(target(395, 50, 10), TIP, VIEW);
    expect(right.left).toBe(292);
    expect(right.arrow).toBe(86);
  });

  it("keeps the arrow off the very corner of the bubble", () => {
    expect(placeTip(target(8, 50, 2), TIP, VIEW).arrow).toBeGreaterThanOrEqual(14);
    expect(placeTip(target(390, 50, 2), TIP, VIEW).arrow).toBeLessThanOrEqual(86);
  });

  it("never goes above the window when it fits nowhere", () => {
    expect(placeTip(target(150, 5), TIP, { width: 400, height: 40 }).top).toBeGreaterThanOrEqual(8);
  });
});

describe("tipTextOf", () => {
  const el = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  };

  it("reads data-tip", () => {
    expect(tipTextOf(el('<button data-tip="  Start the timer ">Go</button>'))).toBe("Start the timer");
  });

  it("takes over a native title so the browser does not show its own beside it", () => {
    const button = el('<button title="Refresh">Go</button>');
    expect(tipTextOf(button)).toBe("Refresh");
    expect(button.hasAttribute("title")).toBe(false);
    expect(button.getAttribute("data-tip")).toBe("Refresh");
  });

  it("keeps an icon-only button named when its title moves", () => {
    const button = el('<button title="Refresh"><svg></svg></button>');
    tipTextOf(button);
    expect(button.getAttribute("aria-label")).toBe("Refresh");
  });

  it("does not overwrite an accessible name that is already there", () => {
    const button = el('<button title="Refresh" aria-label="Reload data"><svg></svg></button>');
    tipTextOf(button);
    expect(button.getAttribute("aria-label")).toBe("Reload data");
  });

  it("gives the longer explanation in help mode and the short tooltip otherwise", () => {
    const button = el('<button data-tip="Start" data-help="Starts the timer on the selected task.">Go</button>');
    expect(tipTextOf(button)).toBe("Start");
    expect(tipTextOf(button, true)).toBe("Starts the timer on the selected task.");
  });

  it("falls back to the tooltip in help mode when there is no explanation", () => {
    expect(tipTextOf(el('<button data-tip="Start">Go</button>'), true)).toBe("Start");
  });

  it("explains an element that has only an explanation", () => {
    expect(tipTextOf(el('<section data-help="Your projects.">x</section>'), true)).toBe("Your projects.");
    expect(tipTextOf(el('<section data-help="Your projects.">x</section>'))).toBe("");
  });

  it("is empty when there is nothing to say", () => {
    expect(tipTextOf(el("<button>Go</button>"))).toBe("");
  });
});
