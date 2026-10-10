"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A boolean "has the visitor done X?" flag persisted in localStorage — used for
 * first-visit onboarding (welcome tour, demo-account hint). Purely a per-browser
 * convenience: if storage is unavailable (private mode, blocked), the flag simply
 * reads as unset and the UI behaves like a first visit.
 *
 * Returns `null` during server rendering and hydration, so callers can avoid
 * flashing first-visit UI before the stored value is known.
 */
const EVENT = "slotly:local-flag";
/** In-memory copy so a dismissal sticks for this page view even when storage is blocked. */
const memory = new Map<string, boolean>();

function read(key: string): boolean {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function useLocalFlag(key: string): [boolean | null, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const set = useCallback(
    (next: boolean) => {
      memory.set(key, next);
      try {
        if (next) window.localStorage.setItem(key, "1");
        else window.localStorage.removeItem(key);
      } catch {
        // Storage blocked — the change still applies for this page view via the event below.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}

/** Opens the welcome tour from anywhere (e.g. the sidebar "Product tour" link). */
export const OPEN_TOUR_EVENT = "slotly:open-tour";
export function openTour() {
  window.dispatchEvent(new Event(OPEN_TOUR_EVENT));
}
