import { useSyncExternalStore } from "react";

let on = false;
const listeners = new Set<() => void>();

export function isHelpMode(): boolean {
  return on;
}

export function setHelpMode(next: boolean): void {
  if (next === on) return;
  on = next;
  document.documentElement.classList.toggle("help-mode", on);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useHelpMode(): boolean {
  return useSyncExternalStore(subscribe, isHelpMode, () => false);
}
