import type { Address } from "viem";

/**
 * One labelled fact in the header panel. `note` is the half-sentence that says what the
 * value *is* — without it the panel is a column of look-alike opaque strings, which is the
 * state this module exists to end.
 */
export type WalletFact = {
  label: string;
  value: string;
  note: string;
  /** Set only for on-chain addresses, so the explorer link never lands on a DID or an fcid. */
  address?: boolean;
  /** The host may offer a control that fetches this value. Only the Fluent ID has one. */
  obtainable?: boolean;
};

/** Shown in place of a value the current sign-in genuinely does not have. */
export const ABSENT = "—";

export type WalletInfoInput = {
  /** `widget.account.type` — "smart" once the ZeroDev kernel is ready, "eoa" for a connected external wallet. */
  accountType: "smart" | "eoa" | undefined;
  /** `widget.account.address`: the kernel for a smart account, the EOA itself otherwise. */
  address: Address | undefined;
  /** `widget.account.signerAddress`: the embedded wallet behind the kernel. Absent for an EOA. */
  signerAddress: Address | undefined;
  /**
   * The token `getAuthToken()` returned — service-signed, `sub` = the Fluent ID.
   *
   * Deliberately not `session.idToken`: in direct auth that one is minted in the browser by
   * `createLocalFluentSession` and its `sub` is the Privy DID, so reading it here would put a
   * DID under a "Fluent ID" label.
   */
  fluentToken: string | undefined;
  /** Where the exchange stands, for the rows the token has not arrived for yet. */
  fluentTokenStatus: "idle" | "loading" | "error";
  /** The exchange's own message, shown verbatim rather than summarised. */
  fluentTokenError: string | undefined;
  /** `session.user.id` — the Privy DID, and only ever that. */
  privyDid: string | undefined;
  xHandle: string | null;
  segments: string[] | undefined;
  sponsorshipHost: string;
};

/**
 * The Fluent ID (`fcid_…`) carried in the `sub` of a Fluent token.
 *
 * Decoded, not verified: this is a label on a screen, and the only party that may trust the
 * token is the service that signed it — a partner backend checks it against
 * `<iss>/.well-known/jwks.json` instead.
 *
 * The `fcid_` test is what keeps the row honest. The widget also carries a
 * `session.idToken` that looks like a JWT and is not one: direct auth fabricates it locally
 * with the Privy DID as `sub`. Accepting any `sub` would print that DID under a "Fluent ID"
 * label.
 */
export function fluentIdFromToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub.startsWith("fcid_") ? sub : undefined;
  } catch {
    // A token this app cannot read is not a failure worth surfacing: the row falls back to
    // ABSENT and every other fact still renders.
    return undefined;
  }
}

/**
 * Always the same rows, in the same order, whatever the sign-in — the panel's job is to make
 * the two ways of connecting comparable, and a row that disappears when it is empty hides
 * exactly the difference the reader is looking for. Missing values read {@link ABSENT} and
 * keep their note.
 *
 * The two-address story it tells: a smart account is two addresses, not one. Privy mints an
 * embedded wallet at login; that EOA is only ever the *signer*. ZeroDev derives a kernel
 * account from it, and the kernel is the ERC-4337 `sender` — the address a paymaster can
 * sponsor and the one on the receipt.
 *
 * An external wallet gets no kernel: it signs and executes as itself, pays its own gas in
 * native ETH, and is therefore invisible to both the sponsorship budget and the ERC-20
 * paymaster. Labelling that EOA "smart account" — which this panel used to do, because it
 * read `address` without reading `type` — inverts the one distinction the page teaches.
 */
export function describeWallet(input: WalletInfoInput): WalletFact[] {
  const fluentId = fluentIdFromToken(input.fluentToken);
  const smart = input.accountType === "smart";
  const eoa = input.accountType === "eoa";

  return [
    {
      label: "Fluent ID",
      value: fluentId ?? ABSENT,
      note: fluentId
        ? "fcid_ — one per partner, the id both sign-in paths share"
        : input.fluentTokenStatus === "loading"
          ? "Exchanging the session for a Fluent token…"
          : input.fluentTokenStatus === "error"
            ? (input.fluentTokenError ?? "The exchange failed")
            : eoa
              ? "Sign an EIP-712 challenge to have the service issue one"
              : smart
                ? "Exchange the Privy session for a Fluent token"
                : "Sign in to get one",
      // Offered again after a failure — a refused or cancelled signature is exactly when a
      // visitor wants to retry. Withheld only while a request is in flight, where a second
      // press would race the first.
      obtainable: !fluentId && input.fluentTokenStatus !== "loading" && (smart || eoa),
    },
    {
      label: "Privy DID",
      value: input.privyDid ?? ABSENT,
      note: "Only an embedded-wallet login has one; an external wallet signs instead",
    },
    {
      label: "X account",
      value: input.xHandle ? `@${input.xHandle}` : ABSENT,
      note: "Linked X profile, where the Fluent profile segments come from",
    },
    {
      label: "Signer",
      value: (smart ? input.signerAddress : eoa ? input.address : undefined) ?? ABSENT,
      note: smart
        ? "Privy embedded wallet — holds the key, signs, never pays"
        : eoa
          ? "External wallet — signs and executes as itself"
          : "Sign in to get one",
      address: Boolean(smart ? input.signerAddress : eoa ? input.address : undefined),
    },
    {
      label: "Smart account",
      value: (smart ? input.address : undefined) ?? ABSENT,
      note: smart
        ? "ZeroDev kernel derived from the signer — the sender gas is sponsored for"
        : eoa
          ? "None: an external wallet has no kernel, so it pays its own gas in ETH"
          : "Derived once the embedded wallet is ready",
      address: Boolean(smart && input.address),
    },
    {
      label: "Segments",
      value: input.segments
        ? input.segments.length > 0
          ? input.segments.join(", ")
          : "none"
        : ABSENT,
      note: "What the sponsorship rules match you against",
    },
    {
      label: "Sponsorship service",
      value: input.sponsorshipHost,
      note: "Answers Dry-run and sponsors the paymaster RPC",
    },
  ];
}
