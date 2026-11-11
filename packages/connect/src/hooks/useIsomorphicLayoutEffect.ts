import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` wherever a browser will run it, `useEffect` on a server.
 *
 * Neither runs during a server render, since React runs no effects there, but React 18's server
 * renderer logs `useLayoutEffect does nothing on the server` for a component that calls the
 * real one. Widget code that needs layout timing in the browser uses this alias
 * so a server render stays silent.
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
