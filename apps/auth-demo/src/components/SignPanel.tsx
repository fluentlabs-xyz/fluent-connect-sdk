import { useCallback, useMemo, useState } from "react";
import {
  FluentAuthError,
  getFluentChainForNetwork,
  type FluentWidgetRenderContext,
} from "@fluent.xyz/connect";
import { createPublicClient, http, recoverTypedDataAddress, type Hex } from "viem";

import { APP_ID, FLUENT_NETWORK } from "../consts";

/** ERC-6492 signatures end with this 32-byte magic suffix. */
const ERC6492_SUFFIX = "6492649264926492649264926492649264926492649264926492649264926492";

type Outcome =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "failed"; message: string }
  | {
      status: "ok";
      signature: Hex;
      wrapped6492: boolean;
      /** viem `verifyTypedData` — EOA, ERC-1271 and ERC-6492 in one call. */
      verified: boolean;
      /** What `ecrecover` would give, for contrast: never the smart account's address. */
      recovered: string;
    };

function formatError(err: unknown) {
  if (err instanceof FluentAuthError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Proves the second thing this demo is about: a signature requested through
 * `widget.signTypedData` verifies with viem's `verifyTypedData` for both account
 * types — and that `ecrecover` is the wrong tool for a smart account.
 */
export function SignPanel({ ctx }: { ctx: FluentWidgetRenderContext }) {
  const { widget } = ctx;
  const [outcome, setOutcome] = useState<Outcome>({ status: "idle" });
  const chain = useMemo(() => getFluentChainForNetwork(FLUENT_NETWORK), []);
  const publicClient = useMemo(() => createPublicClient({ chain, transport: http() }), [chain]);

  const order = useMemo(
    () => ({
      domain: { name: "Fluent Auth Demo", version: "1", chainId: chain.id },
      types: {
        Order: [
          { name: "app", type: "string" },
          { name: "maker", type: "address" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "Order" as const,
      message: {
        app: APP_ID,
        maker: widget.account.address ?? "0x0000000000000000000000000000000000000000",
        nonce: BigInt(Date.now()),
      },
    }),
    [chain.id, widget.account.address],
  );

  const sign = useCallback(async () => {
    const address = widget.account.address;
    if (!address) return;
    setOutcome({ status: "signing" });
    try {
      const signature = await widget.signTypedData(order);
      const [verified, recovered] = await Promise.all([
        publicClient.verifyTypedData({ ...order, address, signature }),
        recoverTypedDataAddress({ ...order, signature }).catch(() => "not recoverable"),
      ]);
      setOutcome({
        status: "ok",
        signature,
        wrapped6492: signature.endsWith(ERC6492_SUFFIX),
        verified,
        recovered,
      });
    } catch (err) {
      setOutcome({ status: "failed", message: formatError(err) });
    }
  }, [order, publicClient, widget]);

  const smart = widget.account.type === "smart";

  return (
    <section className="panel">
      <h1>Fluent signature</h1>
      <p className="muted">
        One call — <code>widget.signTypedData(order)</code> — after the widget's own review.
        This page then verifies the result the way an App would: viem{" "}
        <code>verifyTypedData</code>, which speaks EOA, ERC-1271 and ERC-6492 alike.
      </p>

      <dl className="rows">
        <dt>Order to sign</dt>
        <dd>
          <code className="block wrap">
            {JSON.stringify(order.message, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)}
          </code>
        </dd>
      </dl>

      <button
        type="button"
        className="primary"
        disabled={outcome.status === "signing" || !widget.account.address}
        onClick={sign}
      >
        {outcome.status === "signing" ? "Waiting for the review…" : "Sign typed data"}
      </button>
      {outcome.status === "failed" ? <p className="error">✗ {outcome.message}</p> : null}

      {outcome.status === "ok" ? (
        <dl className="rows">
          <dt>Signature {outcome.wrapped6492 ? <span className="tag">ERC-6492</span> : smart ? <span className="tag">ERC-1271</span> : <span className="tag">ECDSA</span>}</dt>
          <dd>
            <code className="block wrap">{outcome.signature}</code>
            {outcome.wrapped6492 ? (
              <span className="muted">
                wrapped: the smart account is not deployed yet; any transaction through the widget deploys it
              </span>
            ) : null}
          </dd>
          <dt>Verified by this page</dt>
          <dd>
            {outcome.verified ? (
              <span className="ok">✓ <code>verifyTypedData</code> accepts it for <code>{widget.account.address}</code></span>
            ) : (
              <span className="error">✗ <code>verifyTypedData</code> rejects it</span>
            )}
          </dd>
          <dt>What <code>ecrecover</code> sees</dt>
          <dd>
            <code>{outcome.recovered}</code>
            {smart ? (
              <span className="muted">
                {" "}— not the account. A backend comparing recovered addresses rejects every
                smart-account user; verify through ERC-1271/6492 instead.
              </span>
            ) : (
              <span className="muted"> — the wallet itself, as expected for an EOA.</span>
            )}
          </dd>
        </dl>
      ) : null}
    </section>
  );
}
