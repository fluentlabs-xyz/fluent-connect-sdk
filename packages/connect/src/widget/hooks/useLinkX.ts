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
import { useFluentWidget } from "../widgetContext";

export type UseLinkXStatus = "idle" | "pending" | "redirecting" | "linked" | "error";

type LinkXState = {
  status: UseLinkXStatus;
  x: FluentXAccount | null;
  error: FluentAuthError | null;
};

const IDLE: LinkXState = { status: "idle", x: null, error: null };

/**
 * Linking X as a component sees it: the call, and what the last one did.
 *
 * `redirecting` is the status a page is unlikely to render for long — it is set just before the
 * browser leaves for X — and `linked` after a return is what the mount-time re-entry produces
 * without the component asking for anything.
 */
export function useLinkX(): {
  linkX: () => Promise<FluentLinkXResult>;
  status: UseLinkXStatus;
  x: FluentXAccount | null;
  error: FluentAuthError | null;
} {
  const { linkX: requestLink, session, widget } = useFluentWidget();
  const [state, setState] = useState<LinkXState>(IDLE);

  /**
   * One `linkX()`, reported through `status`. `resuming` says whether the component asked for
   * it or the hook is finishing a return on its own, which changes one thing: what a discard
   * means. A caller who asked and whose ask was dropped — somebody else's marker was in the
   * tab — is told so, as `link_failed`, exactly as the render context tells a direct caller.
   * A hook that only resumed what the tab held was not asking for anything: the widget found
   * the marker to be another person's, dropped it, did no work, and this component has nothing
   * to report — it goes back to `idle` with no error. Any other rejection is the component's to
   * see either way.
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
   * The return trip, finished without the component asking. A hop this subject started left a
   * marker behind; the widget's own gate is what waits for Privy, so all this decides is
   * whether there is a return to resume at all.
   *
   * Only the subject that started the hop may resume it. A marker belonging to somebody else —
   * two people sharing a browser — is dropped here and resumes nothing: no refresh, no request,
   * no redirect and no error for a component that was never part of it. A stored value that is
   * not a marker is the same case with less to read: `readLinkXMarker` removes it, and nothing
   * is resumed. The check here reads the stored Fluent session, which is the page's best
   * knowledge before Privy has restored anyone; the verdict that counts is the gate's, made on
   * the user Privy restores, and a resume that the gate then discards — the session named the
   * subject, Privy named somebody else — ends the same way: idle, no error, nothing done.
   *
   * An external wallet has no Fluent session to read: its Privy session is the one SIWE made,
   * and who it belongs to is known only once Privy has restored it and the connector has named
   * the wallet. So for a page with no Fluent session the resume starts as soon as the wallet is
   * connected, and the gate alone decides — `linked` for the wallet that started the hop, a
   * silent discard for any other wallet, and for a page Privy restores nobody on.
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
