"use client";

/* docked() — 03-app.js:6160.

   Docked and modal are two different things and crossing the width has to re-decide which one this
   is: at 1360px and above the drawer is a third grid column beside the page; below it, it slides
   over with a scrim and behaves as a modal. The prototype re-drew on the media query's change
   event; here the same query is a React external store, which also gives a deterministic server
   snapshot — the first paint is the modal form, and it corrects itself on hydration. */

import { useSyncExternalStore } from "react";

const QUERY = "(min-width:1360px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  try {
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  } catch {
    /* Safari < 14 */
    mq.addListener(cb);
    return () => mq.removeListener(cb);
  }
}

const getSnapshot = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;

const getServerSnapshot = () => false;

export function useDocked(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
