import { useCallback, useState } from "react";

import type { FluentAnalyticsTrack } from "../../core/analytics";
import type { FluentWidgetSession } from "../../core/config";
import { toast } from "../../components/ui/toast";
import { 
  toastFaucetError,
  toastFaucetSuccess,
  getAnonymousId,
  HttpError,
  postJson,
} from "../../utils";

/**
 * Testnet BLEND faucet claim. Requires a Fluent session + identity token; on a
 * 401 it tries a silent Privy refresh and, failing that, asks the host to
 * re-open the connect flow via `onReauthRequired`.
 */
export function useFaucet(params: {
  session: FluentWidgetSession | null;
  identityToken?: string | null;
  faucetEndpoint: string;
  refreshBalances: () => void;
  refreshUser: () => Promise<unknown>;
  onReauthRequired: () => void;
  track: FluentAnalyticsTrack;
  setStatus: (status: string | null) => void;
}) {
  const {
    session,
    identityToken,
    faucetEndpoint,
    refreshBalances,
    refreshUser,
    onReauthRequired,
    track,
    setStatus,
  } = params;
  const [faucetBusy, setFaucetBusy] = useState(false);

  const claimFaucet = useCallback(async () => {
    if (!session) {
      toast.add({
        type: "warning",
        title: "Connect required",
        description: "Connect with Fluent ID before claiming faucet.",
      });
      setStatus("Connect with Fluent ID before claiming faucet");
      return;
    }

    if (!identityToken) {
      onReauthRequired();
      return;
    }

    setFaucetBusy(true);
    setStatus("Requesting BLEND faucet");
    const loadingToastId = toast.add({
      type: "loading",
      title: "Requesting faucet",
      description: "Claiming testnet BLEND…",
    });
    try {
      const receipt = await postJson<{ status?: string; txHash?: string; message?: string }>(
        faucetEndpoint,
        {
          visitorId: getAnonymousId(),
          fluentSessionToken: session.idToken,
        },
        {
          Authorization: `Bearer ${identityToken}`,
        },
      );
      toast.close(loadingToastId);
      toastFaucetSuccess(receipt);
      refreshBalances();
      setStatus(receipt.message ?? receipt.txHash ?? receipt.status ?? "Faucet request completed");
      track("wallet_faucet_claimed");
    } catch (err) {
      toast.close(loadingToastId);
      if (err instanceof HttpError && err.status === 401) {
        track("wallet_faucet_failed", { reason: "session_expired" });
        try {
          await refreshUser();
          toast.add({
            type: "info",
            title: "Session refreshed",
            description: "Tap Faucet again to claim BLEND.",
          });
          setStatus("Session refreshed. Tap Faucet again.");
        } catch {
          onReauthRequired();
        }
        return;
      }
      toastFaucetError(err);
      track("wallet_faucet_failed", { reason: "request_failed" });
      setStatus(err instanceof Error ? err.message : "Faucet request failed");
    } finally {
      setFaucetBusy(false);
    }
  }, [
    faucetEndpoint,
    identityToken,
    onReauthRequired,
    refreshBalances,
    refreshUser,
    session,
    setStatus,
    track,
  ]);

  return { faucetBusy, claimFaucet };
}
