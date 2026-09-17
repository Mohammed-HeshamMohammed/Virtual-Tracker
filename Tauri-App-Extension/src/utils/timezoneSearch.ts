import { COUNTRY_NAMES, COUNTRY_ZONES } from "./timezoneCountries.generated";

// 32,000+ cities is too much to make every app launch pay for - it nearly
// quadrupled the whole JS bundle (100KB gzipped -> 320KB) for a dataset only
// the timezone picker's search box ever touches. A dynamic import splits it
// into its own chunk that Vite still bundles into the installer (nothing
// here is a network call - see allZones()'s own doc comment on why this
// agent doesn't make those for its zone list), just not loaded, parsed, or
// paid for until a search actually needs it.
let loadedCityZones: Record<string, string> | null = null;
let cityZonesLoading: Promise<void> | null = null;

/** Starts loading the generated city dataset in the background if it isn't
 *  loading or loaded already - safe to call as often as needed, the import
 *  itself only ever happens once. TimezonePicker calls this the moment its
 *  menu opens, before the member has typed anything, so the dataset is
 *  normally already in memory by the time a query needs it; before this
 *  resolves, zonesMatchingPlaceQuery still answers from every other source
 *  (country, US state, the small hand-picked nickname list) - it just can't
 *  answer from the 32k-city dataset yet. */
export function preloadCityZones(): Promise<void> {
  if (!cityZonesLoading) {
    cityZonesLoading = import("./timezoneCities.generated").then((m) => {
      loadedCityZones = m.CITY_ZONES_GENERATED;
    });
  }
  return cityZonesLoading;
}

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

  // Same 50 states + DC, by their full name - a postal code is what "ny"
  // resolves through, but a search for "texas" has no 2-letter form to
  // fall back on at all.
  alabama: "America/Chicago",
  alaska: "America/Anchorage",
  arizona: "America/Phoenix",
  arkansas: "America/Chicago",
  california: "America/Los_Angeles",
  colorado: "America/Denver",
  connecticut: "America/New_York",
  delaware: "America/New_York",
  florida: "America/New_York",
  georgia: "America/New_York",
  hawaii: "Pacific/Honolulu",
  idaho: "America/Boise",
  illinois: "America/Chicago",
  indiana: "America/Indiana/Indianapolis",
  iowa: "America/Chicago",
  kansas: "America/Chicago",
  kentucky: "America/New_York",
  louisiana: "America/Chicago",
  maine: "America/New_York",
  maryland: "America/New_York",
  massachusetts: "America/New_York",
  michigan: "America/Detroit",
  minnesota: "America/Chicago",
  mississippi: "America/Chicago",
  missouri: "America/Chicago",
  montana: "America/Denver",
  nebraska: "America/Chicago",
  nevada: "America/Los_Angeles",
  "new hampshire": "America/New_York",
  "new jersey": "America/New_York",
  "new mexico": "America/Denver",
  "new york": "America/New_York",
  "north carolina": "America/New_York",
  "north dakota": "America/Chicago",
  ohio: "America/New_York",
  oklahoma: "America/Chicago",
  oregon: "America/Los_Angeles",
  pennsylvania: "America/New_York",
  "rhode island": "America/New_York",
  "south carolina": "America/New_York",
  "south dakota": "America/Chicago",
  tennessee: "America/Chicago",
  texas: "America/Chicago",
  utah: "America/Denver",
  vermont: "America/New_York",
  virginia: "America/New_York",
  washington: "America/Los_Angeles",
  "west virginia": "America/New_York",
  wisconsin: "America/Chicago",
  wyoming: "America/Denver",
  "washington dc": "America/New_York",
  "washington d.c.": "America/New_York",
};

const CITY_ZONES: Record<string, string> = {
  nyc: "America/New_York",
  sf: "America/Los_Angeles",
  philly: "America/New_York",
  atl: "America/New_York",
  kc: "America/Chicago",
};

/** Every zone that could plausibly answer `query` through a country name,
 *  informal country synonym, US state (postal code or full name), or a
 *  city anywhere in the world with a population of 15,000+ - none of which
 *  necessarily appear in the zone id itself ("dallas" isn't a substring of
 *  "America/Chicago", the actual IANA zone Dallas, TX uses). Combine with a
 *  plain id/city/offset substring match for the full search. */
export function zonesMatchingPlaceQuery(query: string): Set<string> {
  const q = query.trim().toLowerCase();
  const matches = new Set<string>();
  if (!q) return matches;

  const stateZone = US_STATE_ZONES[q];
  if (stateZone) matches.add(stateZone);

  const cityZone = CITY_ZONES[q] ?? loadedCityZones?.[q];
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
