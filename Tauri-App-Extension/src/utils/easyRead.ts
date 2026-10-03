import { useSyncExternalStore } from "react";

/**
 * Easy read is a whole-app mode, not just a home screen: the layout choice sets one class
 * (`easy-read`) on the page root and one size variable (`--easy-scale`), and App.css restyles every
 * screen from those - settings, profile, privacy, dialogs, toasts and the sign-in screens - so a
 * screen added later is covered without touching it. The text size (A- / A+) lives here, shared by
 * every screen that offers the buttons.
 */

/** Text sizes the member can step through. */
export const EASY_TEXT_SCALES = [1, 1.25, 1.5, 1.75] as const;
const SCALE_KEY = "vt-easy-text-scale";
export const EASY_READ_CLASS = "easy-read";

type Snapshot = { active: boolean; scaleIndex: number };

function readStoredScaleIndex(): number {
  try {
    const stored = Number(localStorage.getItem(SCALE_KEY));
    const index = EASY_TEXT_SCALES.findIndex((s) => s === stored);
    return index === -1 ? 0 : index;
  } catch {
    return 0;
  }
}

let state: Snapshot = { active: false, scaleIndex: readStoredScaleIndex() };
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  state = next;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle(EASY_READ_CLASS, next.active);
    root.style.setProperty("--easy-scale", String(EASY_TEXT_SCALES[next.scaleIndex]));
  }
  for (const listener of listeners) listener();
}

/** Called by the app whenever the layout changes: Easy read on, or back to a normal layout. */
export function setEasyReadActive(active: boolean): void {
  if (state.active === active) {
    // Still make sure the page matches (first call, or a reload that dropped the class).
    publish(state);
    return;
  }
  publish({ ...state, active });
}

export function setEasyTextScaleIndex(index: number): void {
  const next = Math.min(EASY_TEXT_SCALES.length - 1, Math.max(0, Math.round(index)));
  if (next === state.scaleIndex) return;
  try {
    localStorage.setItem(SCALE_KEY, String(EASY_TEXT_SCALES[next]));
  } catch {
    /* Storage can be unavailable - the size still applies for this run. */
  }
  publish({ ...state, scaleIndex: next });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;

/** Whether Easy read is on, and the text size controls - for any screen that shows them. */
export function useEasyRead() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    active: snap.active,
    scale: EASY_TEXT_SCALES[snap.scaleIndex],
    scaleIndex: snap.scaleIndex,
    canSmaller: snap.scaleIndex > 0,
    canLarger: snap.scaleIndex < EASY_TEXT_SCALES.length - 1,
    smaller: () => setEasyTextScaleIndex(snap.scaleIndex - 1),
    larger: () => setEasyTextScaleIndex(snap.scaleIndex + 1),
  };
}

/** Test seam: back to a clean state. */
export function resetEasyReadForTests(): void {
  state = { active: false, scaleIndex: 0 };
  listeners.clear();
}
