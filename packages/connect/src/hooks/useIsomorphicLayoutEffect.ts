import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` wherever a browser will run it, `useEffect` on a server.
 *
 * Neither ever runs during a server render — React runs no effects there — but React 18's
 * server renderer logs `useLayoutEffect does nothing on the server` for every component that
 * calls the real one, one warning per render per host. Widget code that needs layout timing
 * in the browser uses this alias so a server render stays silent.
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
