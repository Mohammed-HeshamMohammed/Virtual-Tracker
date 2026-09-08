import { COUNTRY_NAMES, COUNTRY_ZONES } from "./timezoneCountries.generated";

const INFORMAL_COUNTRY_NAMES: Record<string, string> = {
  usa: "US",
  us: "US",
  america: "US",
  uae: "AE",
  holland: "NL",
  "ivory coast": "CI",
  macedonia: "MK",
  czechia: "CZ",
  "cabo verde": "CV",
  "south korea": "KR",
  "north korea": "KP",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  persia: "IR",
};

const US_STATE_ZONES: Record<string, string> = {
  al: "America/Chicago",
  ak: "America/Anchorage",
  az: "America/Phoenix",
  ar: "America/Chicago",
  ca: "America/Los_Angeles",
  co: "America/Denver",
  ct: "America/New_York",
  de: "America/New_York",
  fl: "America/New_York",
  ga: "America/New_York",
  hi: "Pacific/Honolulu",
  id: "America/Boise",
  il: "America/Chicago",
  in: "America/Indiana/Indianapolis",
  ia: "America/Chicago",
  ks: "America/Chicago",
  ky: "America/New_York",
  la: "America/Chicago",
  me: "America/New_York",
  md: "America/New_York",
  ma: "America/New_York",
  mi: "America/Detroit",
  mn: "America/Chicago",
  ms: "America/Chicago",
  mo: "America/Chicago",
  mt: "America/Denver",
  ne: "America/Chicago",
  nv: "America/Los_Angeles",
  nh: "America/New_York",
  nj: "America/New_York",
  nm: "America/Denver",
  ny: "America/New_York",
  nc: "America/New_York",
  nd: "America/Chicago",
  oh: "America/New_York",
  ok: "America/Chicago",
  or: "America/Los_Angeles",
  pa: "America/New_York",
  ri: "America/New_York",
  sc: "America/New_York",
  sd: "America/Chicago",
  tn: "America/Chicago",
  tx: "America/Chicago",
  ut: "America/Denver",
  vt: "America/New_York",
  va: "America/New_York",
  wa: "America/Los_Angeles",
  wv: "America/New_York",
  wi: "America/Chicago",
  wy: "America/Denver",
  dc: "America/New_York",
};

const CITY_ZONES: Record<string, string> = {
  nyc: "America/New_York",
  sf: "America/Los_Angeles",
  philly: "America/New_York",
  atl: "America/New_York",
  kc: "America/Chicago",
};

/** Every zone that could plausibly answer `query` through a country name,
 *  informal country synonym, US state postal code, or common city
 *  nickname - none of which necessarily appear in the zone id itself
 *  ("ny" isn't a substring of "New_York"). Combine with a plain
 *  id/city/offset substring match for the full search. */
export function zonesMatchingPlaceQuery(query: string): Set<string> {
  const q = query.trim().toLowerCase();
  const matches = new Set<string>();
  if (!q) return matches;

  const stateZone = US_STATE_ZONES[q];
  if (stateZone) matches.add(stateZone);

  const cityZone = CITY_ZONES[q];
  if (cityZone) matches.add(cityZone);

  const informalCode = INFORMAL_COUNTRY_NAMES[q];
  if (informalCode) {
    for (const zone of COUNTRY_ZONES[informalCode] ?? []) matches.add(zone);
  }

  for (const [code, name] of Object.entries(COUNTRY_NAMES)) {
    if (name.toLowerCase().includes(q)) {
      for (const zone of COUNTRY_ZONES[code] ?? []) matches.add(zone);
    }
  }

  return matches;
}
