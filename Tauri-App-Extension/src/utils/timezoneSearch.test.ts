import { beforeAll, describe, expect, it } from "vitest";
import { preloadCityZones, zonesMatchingPlaceQuery } from "./timezoneSearch";

describe("zonesMatchingPlaceQuery", () => {
  // The generated city dataset loads lazily (see preloadCityZones's doc
  // comment) - without this, every city-name assertion below would run
  // before it's in memory and fail.
  beforeAll(() => preloadCityZones());

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

  it("resolves a full US state name, not just its postal code", () => {
    expect(zonesMatchingPlaceQuery("texas")).toContain("America/Chicago");
    expect(zonesMatchingPlaceQuery("california")).toContain("America/Los_Angeles");
    expect(zonesMatchingPlaceQuery("new york")).toContain("America/New_York");
  });

  it("resolves a real city name to its zone, even though the city's own name never appears in its IANA zone id", () => {
    // The exact gap this was added for: "Dallas" is nowhere in
    // "America/Chicago", the zone it actually uses.
    expect(zonesMatchingPlaceQuery("dallas")).toContain("America/Chicago");
    expect(zonesMatchingPlaceQuery("houston")).toContain("America/Chicago");
    expect(zonesMatchingPlaceQuery("austin")).toContain("America/Chicago");
    expect(zonesMatchingPlaceQuery("miami")).toContain("America/New_York");
    expect(zonesMatchingPlaceQuery("seattle")).toContain("America/Los_Angeles");
    // Nowhere near the US: the generated dataset is worldwide, not just US cities.
    expect(zonesMatchingPlaceQuery("mumbai")).toContain("Asia/Kolkata");
    expect(zonesMatchingPlaceQuery("dubai")).toContain("Asia/Dubai");
  });

  it("picks the more populous city when a name is shared", () => {
    // There is also a much smaller Dallas in Oregon - the Texas one
    // (population in the millions) is what a bare "dallas" should mean.
    expect(zonesMatchingPlaceQuery("dallas")).not.toContain("America/Los_Angeles");
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
