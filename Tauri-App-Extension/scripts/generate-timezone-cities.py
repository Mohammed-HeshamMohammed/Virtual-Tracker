import io

SRC = "cities15000.txt"
OUT = "../src/utils/timezoneCities.generated.ts"

# name(lower) -> (population, zone)
best = {}
total_rows = 0
with io.open(SRC, encoding="utf-8") as f:
    for line in f:
        total_rows += 1
        cols = line.rstrip("\n").split("\t")
        if len(cols) < 18:
            continue
        asciiname = cols[2].strip()
        try:
            population = int(cols[14]) if cols[14] else 0
        except ValueError:
            population = 0
        zone = cols[17].strip()
        if not asciiname or not zone:
            continue
        key = asciiname.lower()
        prev = best.get(key)
        if prev is None or population > prev[0]:
            best[key] = (population, zone)

print(f"parsed {total_rows} rows, {len(best)} unique ascii city names")

# A handful of very short/ambiguous keys are more trouble than they're worth -
# they'd silently shadow a real, useful match elsewhere (zonesMatchingPlaceQuery
# only returns one zone per key). Everything else ships as-is; GeoNames' own
# population figures already picked the more likely city for every collision.
DROP_KEYS = set()

entries = sorted((k, v[1]) for k, v in best.items() if k not in DROP_KEYS)

def js_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')

lines = []
lines.append("// Generated from geonames.org's cities15000.txt (CC BY 4.0,")
lines.append("// download.geonames.org/export/dump/) - every populated place with a")
lines.append("// population of 15,000+, keyed by its lowercased ASCII name to the IANA zone")
lines.append("// of its most populous match (e.g. two cities named \"Dallas\" exist; the one")
lines.append("// in Texas, population 1.3M, wins over the one in Oregon, population 15k).")
lines.append("// This is what resolves a search like \"dallas\" - which appears nowhere in")
lines.append("// its own IANA zone id (\"America/Chicago\") - to the right zone.")
lines.append("// Regenerate from a fresh cities15000.txt with")
lines.append("// scripts/generate-timezone-cities.py, or re-derive the same way; do not")
lines.append("// hand-edit.")
lines.append(f"export const CITY_ZONES_GENERATED: Record<string, string> = {{")
for name, zone in entries:
    lines.append(f'  "{js_escape(name)}": "{zone}",')
lines.append("};")
lines.append("")

with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines))

print(f"wrote {len(entries)} entries to {OUT}")
