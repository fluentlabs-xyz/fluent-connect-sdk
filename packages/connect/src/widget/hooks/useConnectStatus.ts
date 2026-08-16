import { useState } from "react";

/**
 * Shared connect status + error strings surfaced across the hosted, direct-auth,
 * faucet, and disconnect flows. `status` is progress text; `error` is the last
 * connect failure. (Today both feed the debug panel; this is also the seam for
 * surfacing errors in the real UI.)
 */
export function useConnectStatus() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return { status, setStatus, error, setError };
}
