/// <reference types="vite/client" />
// A button with no tooltip is one a member has to guess about, and so is a field with no
// explanation in help mode. These fail when either is added without one.
import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob<string>("../**/*.tsx", { query: "?raw", import: "default", eager: true });

/** Opening tags of every <name, reading past `=>` and other `>` inside braces or comments. */
function tagsNamed(text: string, name: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  for (const match of text.matchAll(new RegExp(`<${name}\\b`, "g"))) {
    const before = text.slice(text.lastIndexOf("\n", match.index) + 1, match.index);
    if (/\/\/|\*/.test(before)) continue;
    let depth = 0;
    let quote = "";
    let i = match.index! + match[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote && text[i - 1] !== "\\") quote = "";
      } else if (c === "/" && text[i + 1] === "/" && depth === 0) {
        i = text.indexOf("\n", i);
      } else if (c === '"' || (depth > 0 && (c === "'" || c === "`"))) quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    found.push({ tag: text.slice(match.index, i + 1), line: text.slice(0, match.index).split("\n").length });
  }
  return found;
}

function withoutThe(attribute: RegExp, names: string[]) {
  const missing: string[] = [];
  let seen = 0;
  for (const [file, text] of Object.entries(SOURCES)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    for (const name of names) {
      for (const { tag, line } of tagsNamed(text, name)) {
        seen++;
        if (!attribute.test(tag)) missing.push(`${file}:${line}`);
      }
    }
  }
  return { seen, missing };
}

describe("tooltips", () => {
  it("every button in the app has one", () => {
    const { seen, missing } = withoutThe(/\bdata-tip=|\btitle=/, ["button"]);
    expect(seen).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  it("every field explains itself in help mode", () => {
    const { seen, missing } = withoutThe(/\bdata-help=/, ["input", "select", "textarea"]);
    expect(seen).toBeGreaterThan(30);
    expect(missing).toEqual([]);
  });

  it("notices a button that has none", () => {
    const tags = tagsNamed('<button type="button" onClick={() => go()}>Go</button>\n<button data-tip="x">Ok</button>', "button");
    expect(tags.map((t) => /data-tip=|title=/.test(t.tag))).toEqual([false, true]);
  });
});
