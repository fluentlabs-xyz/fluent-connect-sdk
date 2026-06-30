import { FluentPermissionGrant, createFluentPermissionClient } from "@fluent/wallet-sdk";
import { useState, useMemo, useCallback, useEffect } from "react";
import { FluentWidgetSession, FLUENT_SDK_SERVICE_URL, FLUENT_CLIENT_ID, CHESS_CONTRACT_ADDRESS, BLEND_TOKEN_ADDRESS, CHESS_TREASURY_ADDRESS } from "../const";
import { formatAddress } from "../utils/formatAddress";
import { fluentTestnet } from "viem/chains";

export function PermissionDemo({
  session,
  compact = false,
}: {
  session: FluentWidgetSession | null;
  compact?: boolean;
}) {
  const [grants, setGrants] = useState<FluentPermissionGrant[]>([]);
  const [status, setStatus] = useState("Connect with Fluent ID to create a permissioned session");
  const [busy, setBusy] = useState(false);
  const client = useMemo(() => {
    if (!session) return null;
    return createFluentPermissionClient({
      baseUrl: FLUENT_SDK_SERVICE_URL,
      clientId: FLUENT_CLIENT_ID,
      getSessionToken: () => session.idToken,
    });
  }, [session]);

  const loadGrants = useCallback(async () => {
    if (!client) {
      setGrants([]);
      return;
    }
    try {
      setGrants(await client.list());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load permissions");
    }
  }, [client]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  const createGrant = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setStatus("Validating requested permissions");
    const request = {
      appId: "fluent_chess_blitz",
      expiry: Math.floor(Date.now() / 1000) + 3600,
      permissions: {
        calls: [
          {
            chainId: fluentTestnet.id,
            to: CHESS_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000",
            function: "submitMove(uint256,string,string)",
            selector: "0xe04f1d81" as const,
          },
        ],
        spend: [
          {
            chainId: fluentTestnet.id,
            token: BLEND_TOKEN_ADDRESS,
            symbol: "BLEND",
            limit: "60",
            period: "hour" as const,
            recipients: [CHESS_TREASURY_ADDRESS],
          },
        ],
      },
    };

    try {
      await client.preview(request);
      setStatus("Creating one-hour permission grant");
      const grant = await client.grant(request);
      setGrants((current) => [grant, ...current.filter((item) => item.id !== grant.id)]);
      setStatus("Permission active. The bot is limited to chess moves and 60 BLEND per hour.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not grant permissions");
    } finally {
      setBusy(false);
    }
  }, [client]);

  const revoke = useCallback(
    async (grantId: string) => {
      if (!client) return;
      setBusy(true);
      setStatus("Revoking permission");
      try {
        const revoked = await client.revoke(grantId);
        setGrants((current) =>
          current.map((grant) => (grant.id === revoked.id ? revoked : grant)),
        );
        setStatus("Permission revoked");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not revoke permission");
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const activeGrant = grants.find((grant) => grant.status === "active");

  return (
    <section className={compact ? "permission-panel permission-panel-compact" : "sdk-panel permission-panel"}>
      <div className="sdk-panel-header">
        <div>
          <p className="eyebrow">Permissioned session</p>
          <h2>Fluent Chess Blitz</h2>
        </div>
        <span className={`permission-state ${activeGrant ? "permission-state-active" : ""}`}>
          {activeGrant ? "Active" : "Not granted"}
        </span>
      </div>

      <div className="permission-summary">
        <div>
          <span>Allowed call</span>
          <strong>BlendChessGame.submitMove</strong>
        </div>
        <div>
          <span>Spend limit</span>
          <strong>60 BLEND / hour</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>1 hour</strong>
        </div>
        <div>
          <span>Treasury</span>
          <strong>{formatAddress(CHESS_TREASURY_ADDRESS)}</strong>
        </div>
      </div>

      {activeGrant ? (
        <div className="permission-active">
          <div>
            <span>Grant ID</span>
            <strong>{activeGrant.id}</strong>
          </div>
          <div>
            <span>Expires</span>
            <strong>{new Date(activeGrant.expiry * 1000).toLocaleTimeString()}</strong>
          </div>
          <button type="button" onClick={() => revoke(activeGrant.id)} disabled={busy}>
            Revoke permission
          </button>
        </div>
      ) : (
        <button
          className="permission-grant-button"
          type="button"
          onClick={createGrant}
          disabled={!session || busy}
        >
          {busy ? "Creating permission" : "Grant chess bot permission"}
        </button>
      )}
      <p className="sdk-panel-status">{status}</p>
    </section>
  );
}
