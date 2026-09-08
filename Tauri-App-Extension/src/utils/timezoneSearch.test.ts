import { describe, expect, it } from "vitest";
import { zonesMatchingPlaceQuery } from "./timezoneSearch";

describe("zonesMatchingPlaceQuery", () => {
  it("resolves a US state postal code to that state's zone", () => {
    expect(zonesMatchingPlaceQuery("ny")).toContain("America/New_York");
    expect(zonesMatchingPlaceQuery("ca")).toContain("America/Los_Angeles");
    expect(zonesMatchingPlaceQuery("tx")).toContain("America/Chicago");
  });

  it("resolves informal country names not covered by the official ISO name", () => {
    const usa = zonesMatchingPlaceQuery("usa");
    expect(usa).toContain("America/New_York");
    expect(usa).toContain("America/Los_Angeles");
    expect(usa).toContain("America/Denver");
    // Netherlands, Belgium and Luxembourg have shared identical civil time
    // since 1970, so IANA canonically groups them under Europe/Brussels -
    // this is the real, correct answer, not a stand-in for Europe/Amsterdam.
    expect(zonesMatchingPlaceQuery("holland")).toContain("Europe/Brussels");
    expect(zonesMatchingPlaceQuery("uae")).toContain("Asia/Dubai");
  });

  it("resolves a partial official country name, not just the full one", () => {
    const zones = zonesMatchingPlaceQuery("united");
    expect(zones.size).toBeGreaterThan(0);
    expect(zones).toContain("America/New_York"); // United States
    expect(zones).toContain("Asia/Dubai"); // United Arab Emirates
  });

  it("resolves a common city nickname to its zone", () => {
    expect(zonesMatchingPlaceQuery("sf")).toContain("America/Los_Angeles");
    expect(zonesMatchingPlaceQuery("nyc")).toContain("America/New_York");
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(zonesMatchingPlaceQuery("")).toEqual(new Set());
    expect(zonesMatchingPlaceQuery("   ")).toEqual(new Set());
    expect(zonesMatchingPlaceQuery("zzzzz-not-a-place")).toEqual(new Set());
  });

  it("is case-insensitive", () => {
    expect(zonesMatchingPlaceQuery("NY")).toContain("America/New_York");
    expect(zonesMatchingPlaceQuery("USA")).toContain("America/New_York");
  });
});
