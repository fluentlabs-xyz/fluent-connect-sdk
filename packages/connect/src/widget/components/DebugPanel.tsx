import type { FluentWidgetSession } from "../../core/config";
import type { FluentExternalWalletState } from "../../core/types";
import { formatExternalWallet } from "../../utils/formatExternalWallet";
import { formatSession } from "../../utils/formatSession";

/**
 * Developer-only panel that dumps the session and external-wallet state. The
 * caller gates rendering (home mode + `debugLogging`/`showDebugPayload`).
 */
export function DebugPanel(props: {
  session: FluentWidgetSession | null;
  wallet: FluentExternalWalletState | null;
  walletStatus: string | null;
  hostedError: string | null;
}) {
  const { session, wallet, walletStatus, hostedError } = props;
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
        <h2 className="m-0 text-base font-medium">Host app callback</h2>
        <span className="rounded-full bg-[#49eded]/15 px-2 py-1 text-xs font-medium text-[#49eded]">
          mock
        </span>
      </div>
      <pre className="overflow-auto p-4 text-xs">{formatSession(session)}</pre>
      <div className="flex items-center justify-between gap-3 border-y border-white/10 px-4 py-3.5">
        <h2 className="m-0 text-base font-medium">External wallet</h2>
        <span className="rounded-full bg-[#49eded]/15 px-2 py-1 text-xs font-medium text-[#49eded]">
          {wallet?.connected ? "Reown" : "wallet"}
        </span>
      </div>
      <pre className="overflow-auto p-4 text-xs">{formatExternalWallet(wallet, walletStatus)}</pre>
      {hostedError ? (
        <p className="m-0 px-4 pb-4 text-[13px] leading-5 text-[#ff8fda]">{hostedError}</p>
      ) : null}
    </section>
  );
}
