import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, isThemePreference } from "./theme";

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
  });

  it("adds theme-light and nothing else for 'light'", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);
    expect(document.documentElement.classList.contains("theme-dark")).toBe(false);
  });

  it("adds theme-dark and nothing else for 'dark'", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
  });

  // "system" removes both classes rather than adding one of its own - the
  // CSS media query only takes over when neither class is present, so this
  // is what actually lets the OS drive the theme.
  it("removes both classes for 'system', leaving neither present", () => {
    document.documentElement.classList.add("theme-dark");
    applyTheme("system");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(false);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
  });

  it("switching directly between light and dark leaves only the new one", () => {
    applyTheme("light");
    applyTheme("dark");
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
  });
});

describe("isThemePreference", () => {
  it("accepts exactly the three valid preferences", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
  });

  it("rejects anything else, including near-misses and non-strings", () => {
    expect(isThemePreference("Light")).toBe(false);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(42)).toBe(false);
  });
});
