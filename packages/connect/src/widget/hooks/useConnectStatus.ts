import { useState } from "react";

/**
 * Returns the connect status and error the login, faucet and disconnect flows write: `status` is
 * progress text, `error` the last connect failure. The debug panel shows both, and the connect
 * modal shows `error`.
 */
export function useConnectStatus() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return { status, setStatus, error, setError };
}
