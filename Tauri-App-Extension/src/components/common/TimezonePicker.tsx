import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { preloadCityZones, zonesMatchingPlaceQuery } from "../../utils/timezoneSearch";

const MENU_WIDTH = 288;
const MENU_GAP = 8;
const MENU_MARGIN = 8;
/** Tall enough for the clock + search box + a handful of rows before the
 *  list itself takes over scrolling - just needs to be a safe upper bound
 *  for the "does it fit below the trigger" check, not exact. */
const MENU_MAX_HEIGHT = 420;

type MenuStyle = { top: number; left: number; maxHeight: number };

/** Where the menu lands relative to the viewport, not the trigger's own
 *  parent - `.tasks-column` (Focus layout's right sidebar) clips overflow
 *  for its rounded corners and scroll containment, and a plain `position:
 *  absolute` menu got clipped to that ~240px box instead of floating over
 *  the page. Portaling to `document.body` with a computed `position: fixed`
 *  sidesteps every ancestor's overflow/stacking context, the same fix
 *  already used for this app's other floating menus. */
function computeMenuStyle(trigger: HTMLElement): MenuStyle {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
  const spaceAbove = rect.top - MENU_GAP;
  const openUpward = spaceBelow < MENU_MAX_HEIGHT / 2 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(160, Math.min(MENU_MAX_HEIGHT, openUpward ? spaceAbove : spaceBelow));
  const top = openUpward ? rect.top - MENU_GAP : rect.bottom + MENU_GAP;
  const left = Math.min(
    Math.max(MENU_MARGIN, rect.left),
    window.innerWidth - MENU_WIDTH - MENU_MARGIN,
  );
  return { top: openUpward ? top - maxHeight : top, left, maxHeight };
}

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuStyle, setMenuStyle] = useState<MenuStyle | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    const sync = () => {
      if (triggerRef.current) setMenuStyle(computeMenuStyle(triggerRef.current));
    };
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [open]);

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

  // The 32k-city dataset loads lazily (see preloadCityZones's doc comment) -
  // kick it off as soon as the menu opens, well before anyone's typed a
  // query, and re-run place matching once it lands so a query typed while it
  // was still loading doesn't get stuck without city results.
  const [cityZonesReady, setCityZonesReady] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void preloadCityZones().then(() => {
      if (!cancelled) setCityZonesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const placeMatches = useMemo(
    () => zonesMatchingPlaceQuery(query),
    [query, cityZonesReady],
  );

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
      const target = event.target as Node;
      // The menu itself is portaled to document.body (see computeMenuStyle's
      // doc comment) - it is not a DOM descendant of rootRef, so a click
      // inside it (selecting a zone) would otherwise read as "outside" and
      // close the menu on pointerdown, before the option's own onClick had
      // a chance to fire on an element that state update was about to
      // unmount.
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
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
        ref={triggerRef}
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

      {open && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="tz-menu tz-menu-portal"
              role="dialog"
              aria-label="Choose a timezone"
              style={{ top: menuStyle.top, left: menuStyle.left, maxHeight: menuStyle.maxHeight }}
            >
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
