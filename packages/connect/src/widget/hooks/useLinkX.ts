import { useCallback, useEffect, useRef, useState } from "react";

import { FluentAuthError } from "../../core/authToken";
import { resolveSessionStorage } from "../../core/browserStorage";
import {
  clearLinkXMarker,
  isLinkXIntentDiscarded,
  ownsLinkXMarker,
  readLinkXMarker,
  type FluentLinkXResult,
  type FluentXAccount,
} from "../../core/linkX";
import { useFluentStoredSession, useFluentWidget } from "../widgetContext";

/**
 * Where `useLinkX()`'s last link stands: `idle` before any, `pending` while one runs,
 * `redirecting` just before the browser leaves for X, `linked` once the Linked X account is
 * there, `error` when the last one was refused.
 */
export type FluentLinkXStatus = "idle" | "pending" | "redirecting" | "linked" | "error";

type LinkXState = {
  status: FluentLinkXStatus;
  x: FluentXAccount | null;
  error: FluentAuthError | null;
};

const IDLE: LinkXState = { status: "idle", x: null, error: null };

/**
 * Returns `linkX()` for a component that links X, with what its last call did: `status`, the
 * Linked X account as `x`, and `error`.
 *
 * `redirecting` is set just before the browser leaves for X, so a page rarely renders it for
 * long. On the return from X the hook calls `linkX()` again on mount, without the component
 * asking, and that call sets `linked`.
 *
 * @throws `FluentAuthError` from the `linkX` it returns, as the render context's `linkX()` does,
 * with `code` `not_authenticated` when no Fluent ID or External wallet is connected or the
 * wallet's client is not ready, `user_rejected` when the person declines at X or a signature the
 * link needs, `linked_to_another_user` when that X account belongs to another person,
 * `bad_request` when the service refuses the request body, and `link_failed` for anything
 * else. The same error is kept in `error`; keep a `default` branch for a code a later release
 * adds.
 *
 * @example
 * ```tsx
 * import { useLinkX } from "@fluent.xyz/connect";
 *
 * export function LinkXButton() {
 *   const { linkX, status, x, error } = useLinkX();
 *   if (x) return <span>Linked as @{x.handle}</span>;
 *   return (
 *     <button onClick={() => void linkX().catch(() => undefined)} disabled={status === "pending"}>
 *       {error ? `Retry (${error.code})` : "Link X"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useLinkX(): {
  linkX: () => Promise<FluentLinkXResult>;
  status: FluentLinkXStatus;
  x: FluentXAccount | null;
  error: FluentAuthError | null;
} {
  const { linkX: requestLink, widget } = useFluentWidget();
  // The subject of a pending link is the stored session's, which the projection a host reads
  // does not carry.
  const session = useFluentStoredSession();
  const [state, setState] = useState<LinkXState>(IDLE);

  /**
   * Runs one `linkX()` and reports it through `status`. `resuming` is whether the hook is
   * finishing a return on its own rather than for the component, and it changes what a discard
   * means: a call the component made whose ask was dropped (somebody else's marker was in the
   * tab) shows `link_failed`, as the render context's `linkX()` rejects; a resume that found
   * another person's marker did no work and goes back to `idle` with no error. Any other
   * rejection reaches `error` either way.
   */
  const run = useCallback(
    async (resuming: boolean): Promise<FluentLinkXResult> => {
      setState({ status: "pending", x: null, error: null });
      try {
        const result = await requestLink();
        if (result.status === "linked") setState({ status: "linked", x: result.x, error: null });
        else setState({ status: "redirecting", x: null, error: null });
        return result;
      } catch (err) {
        if (resuming && isLinkXIntentDiscarded(err)) {
          setState(IDLE);
          throw err;
        }
        // Rejected as well as reported: the hook's caller may be awaiting this promise, and the
        // render context's `linkX()` rejects for the same reasons.
        const error =
          err instanceof FluentAuthError
            ? err
            : new FluentAuthError("link_failed", err instanceof Error ? err.message : String(err));
        setState({ status: "error", x: null, error });
        throw error;
      }
    },
    [requestLink],
  );

  const linkX = useCallback(() => run(false), [run]);

  /**
   * The return from X, finished without the component asking. A hop this subject started left a
   * marker; the widget's own gate waits for Privy, so this decides only whether there is a
   * return to resume.
   *
   * Only the subject that started the hop resumes it. A marker of somebody else's (two people
   * sharing a browser) is dropped here and resumes nothing: no refresh, no request, no redirect
   * and no error. A stored value that is not a marker is removed by `readLinkXMarker`, and
   * nothing is resumed. The check reads the stored session, the page's best knowledge before
   * Privy restores anyone; the gate decides on the user Privy restores, and a resume it discards
   * ends the same way: `idle`, no error, nothing done.
   *
   * An External wallet has no stored session: its Privy session is the one SIWE made, and whose
   * it is is known only once Privy restores it and the connector names the wallet. So with no
   * stored session the resume starts once the wallet is connected, and the gate alone decides:
   * `linked` for the wallet that started the hop, a silent discard for any other wallet or when
   * Privy restores nobody.
   */
  const resumed = useRef(false);
  const subject = session?.user?.id;
  const walletConnected = !session && widget.account.type === "eoa";
  useEffect(() => {
    if (resumed.current) return;
    const storage = resolveSessionStorage();
    const stored = readLinkXMarker(storage);
    if (stored.kind !== "marker") return;
    if (subject) {
      if (!ownsLinkXMarker(stored.marker, subject)) {
        clearLinkXMarker(storage);
        return;
      }
    } else if (!walletConnected) {
      // No subject yet is not "not this subject": the session hydrates before the first render,
      // but a page that is still signing in gets its id later, and the marker waits for it.
      return;
    }
    resumed.current = true;
    // Reported through `status` and `error`; nothing here is left as an unhandled rejection.
    void run(true).catch(() => undefined);
  }, [run, subject, walletConnected]);

  return { ...state, linkX };
}
