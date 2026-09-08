import { useEffect, useMemo, useRef, useState } from "react";
import { zonesMatchingPlaceQuery } from "../../utils/timezoneSearch";

/**
 * Every canonical IANA zone the runtime knows, straight from the platform.
 *
 * Deliberately not a hardcoded list and not a network call. This is the exact
 * set the backend validates against (`Intl.supportedValuesOf("timeZone")` in
 * profile-settings.js), so anything offered here is accepted by construction -
 * and a desktop agent that has to work offline should never depend on a remote
 * list that could drift from what the server will take.
 */
function allZones(): string[] {
  try {
    const supported = (Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf;
    if (typeof supported === "function") return supported("timeZone");
  } catch {
    /* falls through to the single-entry fallback below */
  }
  // Pre-Chromium-99 WebView2: at least let the picker show the current zone
  // rather than rendering an empty list.
  try {
    return [Intl.DateTimeFormat().resolvedOptions().timeZone].filter(Boolean);
  } catch {
    return [];
  }
}

/** "GMT+03:00" for the zone as of right now, so the label tracks DST. */
function offsetOf(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    if (!name) return "GMT+00:00";
    return name === "GMT" ? "GMT+00:00" : name;
  } catch {
    return "GMT+00:00";
  }
}

function offsetMinutes(offset: string): number {
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** "12:00 AM" wall-clock time in `zone` right now - the whole point of
 *  picking a timezone is seeing what time it is there, not just its offset.
 *  `hour: "numeric"` (not "2-digit") is deliberate: a 12-hour clock reads
 *  "1:05 PM", not "01:05 PM" - 2-digit only makes sense once hour12 is off. */
function clockOf(zone: string, at: number): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(at));
  } catch {
    return "--:--";
  }
}

/** City half of an IANA id, for display and search: "Africa/Cairo" -> "Cairo". */
function cityOf(zone: string): string {
  const tail = zone.split("/").pop() ?? zone;
  return tail.replace(/_/g, " ");
}

export function TimezonePicker({
  value,
  onSelect,
  saving,
}: {
  value: string;
  onSelect: (zone: string) => void;
  saving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Minute resolution is all a wall-clock badge needs; a 1s tick would just
  // burn re-renders on every task-progress poll cycle for no visible change.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const zones = useMemo(() => {
    return allZones()
      .map((zone) => {
        const offset = offsetOf(zone);
        return { zone, offset, minutes: offsetMinutes(offset), city: cityOf(zone) };
      })
      .sort((a, b) => a.minutes - b.minutes || a.zone.localeCompare(b.zone));
  }, []);

  const placeMatches = useMemo(() => zonesMatchingPlaceQuery(query), [query]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return zones;
    return zones.filter(
      (z) =>
        z.zone.toLowerCase().includes(needle) ||
        z.city.toLowerCase().includes(needle) ||
        z.offset.toLowerCase().includes(needle) ||
        placeMatches.has(z.zone),
    );
  }, [zones, query, placeMatches]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onDocPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Never resolves to "" - an unset member zone is shown as the machine's own,
  // which is what the backend falls back to anyway.
  const current = value || (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  })();

  return (
    // No data-tauri-drag-region anywhere in here: any drag-region ancestor
    // would make every click drag the window instead of opening the menu.
    <div className="tz-picker" ref={rootRef}>
      <button
        type="button"
        className="tz-trigger"
        title={`Timezone: ${current} (${offsetOf(current)}) - your day boundaries are resolved in this zone`}
        aria-label={`Timezone: ${current}. Change`}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={saving}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="tz-globe">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
        <span className="tz-trigger-lines">
          <span className="tz-trigger-time">{clockOf(current, now)}</span>
          <span className="tz-trigger-zone">
            {cityOf(current)} {offsetOf(current)}
          </span>
        </span>
      </button>

      {open ? (
        <div className="tz-menu" role="dialog" aria-label="Choose a timezone">
          <div className="tz-menu-clock">
            <span className="tz-menu-clock-time">{clockOf(current, now)}</span>
            <span className="tz-menu-clock-zone">
              {cityOf(current)} {offsetOf(current)}
            </span>
          </div>
          <input
            ref={inputRef}
            className="tz-search"
            type="text"
            placeholder="Search city, country or offset"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="tz-list" role="listbox" tabIndex={-1}>
            {filtered.length === 0 ? (
              <div className="tz-empty">No timezone matches that.</div>
            ) : (
              filtered.map((z) => (
                <button
                  key={z.zone}
                  type="button"
                  role="option"
                  aria-selected={z.zone === current}
                  className={`tz-option${z.zone === current ? " is-current" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (z.zone !== current) onSelect(z.zone);
                  }}
                >
                  <span className="tz-option-zone">{z.zone.replace(/_/g, " ")}</span>
                  <span className="tz-option-offset">{z.offset}</span>
                </button>
              ))
            )}
          </div>
          <p className="tz-note">
            Changing this re-dates work already tracked today.
          </p>
        </div>
      ) : null}
    </div>
  );
}
