import type { Address } from "viem";

/**
 * One labelled fact in the header panel. `note` is the half-sentence that says what the value
 * is, so the panel is not a column of look-alike opaque strings.
 */
export type WalletFact = {
  label: string;
  value: string;
  note: string;
  /** Set only for on-chain addresses, so the explorer link never lands on a DID or an fcid. */
  address?: boolean;
  /** Set when the panel may offer a control that fetches this value; only the first row has one. */
  obtainable?: boolean;
};

/** Shown in place of a value the current sign-in genuinely does not have. */
export const ABSENT = "—";

export type WalletInfoInput = {
  /** `widget.account.type`: "smart" once the kernel is ready, "eoa" for an External wallet. */
  accountType: "smart" | "eoa" | undefined;
  /** `widget.account.address`: the kernel for a Fluent ID, the External wallet's own otherwise. */
  address: Address | undefined;
  /** The Signer behind the kernel, read off Privy; absent for an External wallet. */
  signerAddress: Address | undefined;
  /**
   * The Auth token `getAuthToken()` returned, signed by the service. Not the stored session's
   * `idToken`, which Direct login mints in the browser with the Privy DID as its `sub`.
   */
  fluentToken: string | undefined;
  /** Where the exchange stands, for the rows the token has not arrived for yet. */
  fluentTokenStatus: "idle" | "loading" | "error";
  /** The exchange's own message, shown verbatim rather than summarised. */
  fluentTokenError: string | undefined;
  /** Privy's `user.id`, the Privy DID. */
  privyDid: string | undefined;
  xHandle: string | null;
  segments: string[] | undefined;
  sponsorshipHost: string;
};

/**
 * Returns the Client subject (`fcid_…`) in the `sub` of an Auth token, or undefined.
 *
 * Decoded, not verified: it is only a label on a screen, and an App backend verifies the token
 * against `<iss>/.well-known/jwks.json` instead. The `fcid_` check rejects a locally minted
 * `idToken`, whose `sub` is the Privy DID.
 */
export function fluentIdFromToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub.startsWith("fcid_") ? sub : undefined;
  } catch {
    // An unreadable token leaves the row ABSENT; every other fact still renders.
    return undefined;
  }
}

/**
 * Returns the header panel's rows: the same rows in the same order whatever the sign-in, so
 * the two ways of connecting can be compared, with {@link ABSENT} for a missing value.
 *
 * A Fluent ID is two addresses: the Signer Privy creates at login, which only signs, and the
 * ZeroDev kernel derived from it, the ERC-4337 `sender` a paymaster can sponsor. An External
 * wallet has no kernel: it signs and executes as itself and pays its own gas, so the smart
 * account row reads `accountType`, not only `address`.
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
        ? "fcid_ — one per App, the id both sign-in paths share"
        : input.fluentTokenStatus === "loading"
          ? "Exchanging the session for a Fluent token…"
          : input.fluentTokenStatus === "error"
            ? (input.fluentTokenError ?? "The exchange failed")
            : eoa
              ? "Sign an EIP-712 challenge to have the service issue one"
              : smart
                ? "Exchange the Privy session for a Fluent token"
                : "Sign in to get one",
      // Offered again after a failure, so a refused signature can be retried; withheld while a
      // request is in flight, where a second press would race the first.
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
