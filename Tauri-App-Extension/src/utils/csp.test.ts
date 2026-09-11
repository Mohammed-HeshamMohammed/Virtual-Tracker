import { describe, expect, it } from "vitest";
// Imported, not read from disk: this is a webview project with no Node types,
// and under jsdom `import.meta.url` is not a file: URL, so fs cannot reach it.
// resolveJsonModule is on, and this is the same file the build embeds.
import tauriConfig from "../../src-tauri/tauri.conf.json";

/**
 * The app's Content Security Policy has to allow every kind of URL the app
 * itself puts into an <img>.
 *
 * v1.0.2 moved screenshot images out of the JS heap into Blobs behind
 * `blob:` object URLs (utils/image-cache.ts) to stop the webview running out of
 * memory. The CSP's `img-src` still allowed only `'self' https: data:`, so the
 * policy blocked every one of those images and each screenshot preview showed a
 * broken-image icon. Unit tests could not see it - jsdom does not enforce CSP -
 * and it shipped in two releases.
 *
 * This reads the real config the build uses, so a change on either side that
 * reopens the gap fails here instead of in front of a user.
 */
function directive(csp: string, name: string): string[] {
  const entry = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return entry ? entry.split(/\s+/).slice(1) : [];
}

const config = tauriConfig as { app?: { security?: { csp?: string } } };
const csp = config.app?.security?.csp ?? "";

describe("content security policy", () => {
  it("is present, so the checks below are testing something", () => {
    expect(csp).toContain("img-src");
  });

  // image-cache.ts turns every screenshot into a blob: object URL.
  it("allows blob: images, which is how screenshots are displayed", () => {
    expect(directive(csp, "img-src")).toContain("blob:");
  });

  // Avatars and favicons are remote https images; the older data: path is
  // still used for anything not yet moved to the cache.
  it("still allows the image sources it allowed before", () => {
    const imgSrc = directive(csp, "img-src");
    for (const source of ["'self'", "https:", "data:"]) {
      expect(imgSrc).toContain(source);
    }
  });

  // blob: belongs in img-src only. Scripts from blob: URLs would let anything
  // that can build a Blob run code, which is the whole thing script-src exists
  // to prevent.
  it("does not extend blob: to scripts", () => {
    expect(directive(csp, "script-src")).not.toContain("blob:");
  });
});
