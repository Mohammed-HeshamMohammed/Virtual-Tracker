import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM in this environment: give the module the two things it touches.
const classes = new Set<string>();
const vars = new Map<string, string>();
const storage = new Map<string, string>();
vi.stubGlobal("document", {
  documentElement: {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
    style: { setProperty: (k: string, v: string) => vars.set(k, v) },
  },
});
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
});

const mod = await import("./easyRead");

beforeEach(() => {
  classes.clear();
  vars.clear();
  storage.clear();
  mod.resetEasyReadForTests();
});

describe("easy read mode", () => {
  it("puts one class on the page root while the layout is Easy read, and takes it off after", () => {
    mod.setEasyReadActive(true);
    expect(classes.has("easy-read")).toBe(true);
    mod.setEasyReadActive(false);
    expect(classes.has("easy-read")).toBe(false);
  });

  it("publishes the text size as --easy-scale so every screen can scale from it", () => {
    mod.setEasyReadActive(true);
    expect(vars.get("--easy-scale")).toBe("1");
    mod.setEasyTextScaleIndex(2);
    expect(vars.get("--easy-scale")).toBe("1.5");
  });

  it("steps through the four sizes, never past either end, and remembers the choice", () => {
    expect(mod.EASY_TEXT_SCALES).toEqual([1, 1.25, 1.5, 1.75]);
    mod.setEasyTextScaleIndex(99);
    expect(vars.get("--easy-scale")).toBe("1.75");
    expect(storage.get("vt-easy-text-scale")).toBe("1.75");
    mod.setEasyTextScaleIndex(-5);
    expect(vars.get("--easy-scale")).toBe("1");
    expect(storage.get("vt-easy-text-scale")).toBe("1");
  });

  it("re-applies the class when asked again, so a page that lost it gets it back", () => {
    mod.setEasyReadActive(true);
    classes.clear();
    mod.setEasyReadActive(true);
    expect(classes.has("easy-read")).toBe(true);
  });
});
