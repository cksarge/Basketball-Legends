"use client";
// Your best street reputation from any career: what opens parks in standalone Play in the Park.
import { useSyncExternalStore } from "react";

const KEY = "bl-street-rep";
const EVENT = "bl-street-rep-change";

function read() {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Keeps the highest reputation any career has reached: a park you've earned stays open. */
export function recordStreetRep(rep: number) {
  if (rep <= read()) return;
  try {
    localStorage.setItem(KEY, String(rep));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage full or blocked: the parks stay as they were */
  }
}

const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
};

/** Empty while prerendering, so the page matches on load. */
export const useStreetRep = () => useSyncExternalStore(subscribe, read, () => 0);
