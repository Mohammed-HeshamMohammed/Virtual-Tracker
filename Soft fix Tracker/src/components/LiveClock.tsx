import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../workspace";
import "./live-clock.css";

const pad = (value: number, width = 2) => String(value).padStart(width, "0");
const TICKS = Array.from({ length: 60 }, (_, index) => index);

/** True when the person asked for less motion, in Soft Fix's settings or in their system's. */
function useReducedMotion(chosen: boolean) {
  const [system, setSystem] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystem(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return chosen || system;
}

/** One digit that rolls. When it changes, the new digit slides up into place with a little
 *  overshoot, like a spring, while the old one lifts away and fades; a soft mask hides the edges. */
function RollDigit({ value }: { value: number }) {
  const [shown, setShown] = useState({ current: value, previous: null as number | null, flip: 0 });
  // Derived from the prop during render, so the old digit is never painted without its exit.
  if (shown.current !== value) setShown({ current: value, previous: shown.current, flip: shown.flip + 1 });
  useEffect(() => {
    if (shown.previous === null) return;
    const done = setTimeout(() => setShown((old) => ({ ...old, previous: null })), 520);
    return () => clearTimeout(done);
  }, [shown.flip, shown.previous]);
  return (
    <span className="lc-digit">
      {shown.previous !== null && (
        <span className="lc-out" key={`out-${shown.flip}`}>
          {shown.previous}
        </span>
      )}
      <span className={shown.flip ? "lc-in" : undefined} key={`in-${shown.flip}`}>
        {shown.current}
      </span>
    </span>
  );
}

/** The timer's face: hours, minutes and seconds that roll as they change, milliseconds running
 *  beside them, and under them a ruler of 60 ticks, one for each second of the minute, with a glowing
 *  head that sweeps along it and sends out a pulse on every second.
 *
 *  The time is worked out from `startedAt` and `baseSeconds` on every animation frame, so it is exact
 *  however the page is throttled; the milliseconds, the colons and the head are written straight to
 *  the page (no React render 60 times a second), and React only re-renders once a second, when a digit
 *  changes. With reduced motion there is no rolling or pulsing, the head steps once a second, and the
 *  milliseconds update ten times a second instead of every frame. */
export function LiveClock({
  startedAt,
  baseSeconds,
  label,
  className = "",
  ruler = true,
}: {
  /** When the current run began (ms since the epoch), or null when the timer is not running. */
  startedAt: number | null;
  /** Seconds banked before the current run. */
  baseSeconds: number;
  /** What a screen reader hears (it is told the time once, not every tick). */
  label: string;
  className?: string;
  ruler?: boolean;
}) {
  const { preferences } = useWorkspace();
  const reduced = useReducedMotion(preferences.reducedMotion);
  // The milliseconds follow the person's own setting. Reduced motion only makes them calmer.
  const showMs = preferences.showMilliseconds;
  const running = startedAt !== null;
  const exact = () => baseSeconds + (startedAt === null ? 0 : Math.max(0, (Date.now() - startedAt) / 1000));
  const [whole, setWhole] = useState(() => Math.floor(exact()));
  const lastWhole = useRef(whole);
  const millis = useRef<HTMLSpanElement>(null);
  const colonA = useRef<HTMLSpanElement>(null);
  const colonB = useRef<HTMLSpanElement>(null);
  const head = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const paint = () => {
      const total = exact();
      const second = Math.floor(total);
      const fraction = reduced ? 0 : total - second;
      if (second !== lastWhole.current) {
        lastWhole.current = second;
        setWhole(second);
      }
      if (millis.current) millis.current.textContent = `.${pad(Math.floor((total - second) * 1000), 3)}`;
      // The colons flash on the second and fade until the next one: the visible tick.
      const colon = running && !reduced ? String(0.32 + 0.68 * (1 - fraction) ** 2) : "";
      if (colonA.current) colonA.current.style.opacity = colon;
      if (colonB.current) colonB.current.style.opacity = colon;
      if (head.current) head.current.style.left = `${(((second % 60) + fraction) / 60) * 100}%`;
    };
    paint();
    if (!running) return;
    if (reduced) {
      const steady = setInterval(paint, 100);
      return () => clearInterval(steady);
    }
    let frame = requestAnimationFrame(function loop() {
      paint();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
    // `exact` closes over startedAt and baseSeconds, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, baseSeconds, running, reduced, showMs]);

  const hours = Math.floor(whole / 3600) % 100;
  const minutes = Math.floor(whole / 60) % 60;
  const seconds = whole % 60;
  const state = running ? "is-running" : baseSeconds > 0 ? "is-paused" : "is-idle";

  return (
    <div className={`lc ${state} ${showMs ? "has-ms" : ""} ${className}`.trim()} role="timer" aria-label={label} aria-live="off">
      <div className="lc-face" aria-hidden="true">
        <RollDigit value={Math.floor(hours / 10)} />
        <RollDigit value={hours % 10} />
        <span className="lc-colon" ref={colonA}>
          :
        </span>
        <RollDigit value={Math.floor(minutes / 10)} />
        <RollDigit value={minutes % 10} />
        <span className="lc-colon" ref={colonB}>
          :
        </span>
        <RollDigit value={Math.floor(seconds / 10)} />
        <RollDigit value={seconds % 10} />
        {showMs && (
          <span className="lc-ms" ref={millis}>
            .000
          </span>
        )}
      </div>
      {ruler && (
        <div className="lc-ruler" aria-hidden="true">
          {TICKS.map((tick) => (
            <i key={tick} className={`${tick % 5 === 0 ? "major" : ""} ${tick < seconds ? "lit" : ""} ${running && tick === seconds ? "now" : ""}`.trim()} />
          ))}
          <span className="lc-head" ref={head}>
            <span className="lc-pulse" key={whole} />
          </span>
        </div>
      )}
    </div>
  );
}
