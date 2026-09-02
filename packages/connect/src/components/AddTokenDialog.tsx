import {
  fluentTokenKey,
  readFluentTokenMetadata,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, isAddress } from "viem";

import { createFluentRpcTransport } from "../core/rpc";
import type { FluentUserTokenAddResult } from "../core/userTokens";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type LookupState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "found"; token: FluentTokenDefinition }
  | { phase: "rejected"; message: string };

export function AddTokenDialog({
  open,
  onOpenChange,
  existingSymbols,
  existingKeys,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Symbols already on the list, lowercased, to warn about impersonation. */
  existingSymbols: ReadonlySet<string>;
  /** Identities already on the list, from any source, to reject re-adding. */
  existingKeys: ReadonlySet<string>;
  onAdd: (token: FluentTokenDefinition) => FluentUserTokenAddResult;
}) {
  const { chain } = useFluentWidgetNetwork();
  const [address, setAddress] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ phase: "idle" });
  const [addError, setAddError] = useState<string | null>(null);

  const publicClient = useMemo(
    () => createPublicClient({ chain, transport: createFluentRpcTransport(chain) }),
    [chain],
  );

  const reset = useCallback(() => {
    setAddress("");
    setLookup({ phase: "idle" });
    setAddError(null);
  }, []);

  // the contract is the only source of the metadata, so the lookup runs as soon
  // as the field holds something address-shaped rather than behind a button
  useEffect(() => {
    if (!open) return;
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
  }, [address, chain.id, open, publicClient]);

  const token = lookup.phase === "found" ? lookup.token : null;
  const collides = token ? existingSymbols.has(token.symbol.toLowerCase()) : false;
  // Checked against the whole display list, not just the user's own tokens: a
  // curated token would otherwise be stored and then shadowed by the curated
  // entry, so the dialog would close having visibly done nothing.
  const alreadyListed = token ? existingKeys.has(fluentTokenKey(token)) : false;

  const handleAdd = () => {
    if (!token) return;
    const result = onAdd(token);
    switch (result.status) {
      case "added":
        reset();
        onOpenChange(false);
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a token</DialogTitle>
          <DialogDescription>
            Paste the token's contract address on {chain.name}. Its name and decimals are
            read from the contract.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <input
            aria-label="Token contract address"
            className="w-full rounded-xl bg-white/5 px-3 py-2 font-mono text-xs leading-5 ring-1 ring-foreground/10 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
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
            <div className="flex flex-col gap-2 rounded-xl bg-white/5 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{token.symbol}</span>
                <span className="text-xs text-muted-foreground">
                  {token.decimals} decimals
                </span>
              </div>
              <span className="text-xs text-muted-foreground">{token.name}</span>
              <span className="font-mono text-[11px] leading-4 break-all text-muted-foreground">
                {token.address}
              </span>
            </div>
          ) : null}

          {alreadyListed ? (
            <p className="text-xs text-muted-foreground">
              This token is already on your list.
            </p>
          ) : null}

          {collides && !alreadyListed ? (
            <div className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                A token called {token?.symbol} is already on your list. Check the address
                above matches the token you mean — anyone can deploy a token using someone
                else's symbol.
              </span>
            </div>
          ) : null}

          {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!token || alreadyListed} onClick={handleAdd}>
            {collides && !alreadyListed ? "Add anyway" : "Add token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
