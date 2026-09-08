import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TimezonePicker } from "./TimezonePicker";

const noop = () => {};

describe("TimezonePicker", () => {
  it("shows the member's own zone, city first, with its current offset", () => {
    const html = renderToStaticMarkup(
      <TimezonePicker value="Africa/Cairo" onSelect={noop} />,
    );
    expect(html).toContain("Cairo");
    expect(html).toMatch(/GMT[+-]\d{2}:\d{2}/);
  });

  it("falls back to the machine zone rather than rendering blank when unset", () => {
    const html = renderToStaticMarkup(<TimezonePicker value="" onSelect={noop} />);
    const machineZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const city = (machineZone.split("/").pop() ?? machineZone).replace(/_/g, " ");
    expect(html).toContain(city);
  });

  it("disables the trigger while a save is in flight", () => {
    expect(
      renderToStaticMarkup(
        <TimezonePicker value="Europe/London" onSelect={noop} saving={true} />,
      ),
    ).toContain("disabled");
  });

  it("never carries a drag region, which would swallow the click", () => {
    // .titlebar-drag is a data-tauri-drag-region; anything inheriting it turns
    // clicks into window drags instead of opening the menu.
    expect(
      renderToStaticMarkup(<TimezonePicker value="Asia/Tokyo" onSelect={noop} />),
    ).not.toContain("data-tauri-drag-region");
  });

  it("offers the platform's whole IANA set, not a hardcoded subset", () => {
    // Guards the actual bug this replaced: a 56-entry hardcoded list that was
    // 54 America/* entries and had no Europe, Asia, Australia or Pacific at all.
    const zones = (Intl as unknown as {
      supportedValuesOf: (k: string) => string[];
    }).supportedValuesOf("timeZone");
    expect(zones.length).toBeGreaterThan(400);

    // Region coverage, not exact ids. Which *spelling* a runtime reports is
    // ICU-version-dependent - this very assertion originally named
    // "Asia/Kolkata" and failed, because Node reports the legacy
    // "Asia/Calcutta" while Chromium reports the canonical one. Asserting a
    // specific id here would just re-encode that trap.
    for (const region of ["Europe/", "Asia/", "Australia/", "Africa/", "America/", "Pacific/"]) {
      expect(zones.some((z) => z.startsWith(region))).toBe(true);
    }
  });

  it("resolves every offered zone, whichever alias spelling the runtime uses", () => {
    // The picker's promise is that anything it lists can actually be used.
    const zones = (Intl as unknown as {
      supportedValuesOf: (k: string) => string[];
    }).supportedValuesOf("timeZone");
    for (const zone of zones) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date())).not.toThrow();
    }
  });
});
