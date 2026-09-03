import {
  fluentTokenIdentity,
  readFluentTokenMetadata,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, isAddress } from "viem";

import { createFluentRpcTransport } from "../core/rpc";
import type { FluentUserTokenAddResult } from "../core/userTokens";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";
import { Button } from "./ui/button";

type LookupState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "found"; token: FluentTokenDefinition }
  | { phase: "rejected"; message: string };

export function AddTokenForm({
  existingSymbols,
  listedIdentities,
  onAdd,
  onClose,
}: {
  /** Symbols already on the list, lowercased, to warn about impersonation. */
  existingSymbols: ReadonlySet<string>;
  /** Identities already on the list, from any source, to reject re-adding. */
  listedIdentities: ReadonlySet<string>;
  onAdd: (token: FluentTokenDefinition) => FluentUserTokenAddResult;
  onClose: () => void;
}) {
  const { chain } = useFluentWidgetNetwork();
  const [address, setAddress] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ phase: "idle" });
  const [addError, setAddError] = useState<string | null>(null);

  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: createFluentRpcTransport(chain) }),
    [chain],
  );

  // The contract is the only source of the metadata, so the lookup runs as soon
  // as the field holds something address-shaped rather than behind a button.
  useEffect(() => {
    const trimmed = address.trim();
    if (!trimmed) {
      setLookup({ phase: "idle" });
      return;
    }
    if (!isAddress(trimmed)) {
      setLookup({ phase: "rejected", message: "That is not a contract address." });
      return;
    }

    let cancelled = false;
    setLookup({ phase: "loading" });
    void readFluentTokenMetadata({
      client: publicClient,
      address: trimmed,
      chainId: chain.id,
    }).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setLookup({ phase: "found", token: result.token });
        return;
      }
      setLookup({
        phase: "rejected",
        message:
          result.status === "invalid-address"
            ? "That is not a contract address."
            : `No token found at this address. ${result.reason}`,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [address, chain.id, publicClient]);

  const token = lookup.phase === "found" ? lookup.token : null;
  const collides = token ? existingSymbols.has(token.symbol.toLowerCase()) : false;
  // Checked against the whole display list, not just the user's own tokens: a
  // token Fluent already ships would otherwise be stored and then shadowed by
  // our own entry, so the form would clear having visibly done nothing.
  const alreadyListed = token ? listedIdentities.has(fluentTokenIdentity(token)) : false;

  const handleAdd = () => {
    if (!token) return;
    const result = onAdd(token);
    switch (result.status) {
      case "added":
        onClose();
        return;
      case "already-present":
        setAddError("This token is already on your list.");
        return;
      case "at-capacity":
        setAddError(`You can add up to ${result.limit} tokens per network.`);
        return;
      default:
        setAddError("This token could not be added.");
    }
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-xl bg-white/5 p-3"
      aria-label="Add a token"
    >
      <span className="text-xs text-muted-foreground">
        Paste the token's contract address on {chain.name}. Its name and decimals are read
        from the contract.
      </span>

      <input
        aria-label="Token contract address"
        className="w-full rounded-lg bg-black/30 px-2.5 py-2 font-mono text-xs leading-5 ring-1 ring-foreground/10 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
        placeholder="0x…"
        spellCheck={false}
        autoComplete="off"
        autoFocus
        value={address}
        onChange={(event) => {
          setAddError(null);
          setAddress(event.target.value);
        }}
      />

      {lookup.phase === "loading" ? (
        <p className="text-xs text-muted-foreground">Reading the contract…</p>
      ) : null}

      {lookup.phase === "rejected" ? (
        <p className="text-xs text-destructive">{lookup.message}</p>
      ) : null}

      {token ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-black/30 p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{token.symbol}</span>
            <span className="text-xs text-muted-foreground">{token.decimals} decimals</span>
          </div>
          <span className="text-xs text-muted-foreground">{token.name}</span>
          {/* Always the full address, never truncated: it is the only thing that
              distinguishes this token from one impersonating it. */}
          <span className="font-mono text-[11px] leading-4 break-all text-muted-foreground">
            {token.address}
          </span>
        </div>
      ) : null}

      {alreadyListed ? (
        <p className="text-xs text-muted-foreground">This token is already on your list.</p>
      ) : null}

      {collides && !alreadyListed ? (
        <div className="flex gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            A token called {token?.symbol} is already on your list. Check the address above
            matches the token you mean — anyone can deploy a token using someone else's
            symbol.
          </span>
        </div>
      ) : null}

      {addError ? <p className="text-xs text-destructive">{addError}</p> : null}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="rounded-full px-3" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="rounded-full px-3"
          disabled={!token || alreadyListed}
          onClick={handleAdd}
        >
          {collides && !alreadyListed ? "Add anyway" : "Add token"}
        </Button>
      </div>
    </div>
  );
}
