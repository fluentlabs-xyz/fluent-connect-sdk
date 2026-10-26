import type {
  Address,
  Hex,
  SignableMessage,
  TypedData,
  TypedDataDefinition,
  WalletClient,
} from "viem";

import { FluentAuthError } from "../core/authToken";
import type { FluentSigningMode, FluentWidgetAccount } from "./batchOperation";
import type { FluentZeroDevKernel } from "./zerodevSession";

/**
 * A typed-data request with its generics erased: what the review shows and what the
 * signer receives. `signTypedData` on the public API keeps viem's generic signature so
 * hosts get their `types` checked; the erasure happens once, at the API boundary.
 */
export type FluentTypedDataRequest = TypedDataDefinition<TypedData | Record<string, unknown>, string>;

/**
 * What the user reviews before a signature is produced. `origin` is the page asking,
 * which is the one fact a signature request cannot be trusted to state about itself;
 * `address` is the account the signature will be for.
 */
export type FluentSignatureReview = {
  origin: string;
  account: FluentWidgetAccount;
  address: Address;
} & (
  | { kind: "message"; message: SignableMessage }
  | { kind: "typedData"; typedData: FluentTypedDataRequest }
);

/**
 * The Kernel-side surface a signature needs: the ZeroDev account's ERC-1271 signers,
 * and which key sits behind them. Signing is refused for anything but the root Signer,
 * so a permission-session kernel can never produce an account signature.
 */
export type FluentSigningKernel = {
  signerSource: FluentZeroDevKernel["signerSource"];
  account: {
    signMessage: (params: { message: SignableMessage }) => Promise<Hex>;
    signTypedData: (typedData: FluentTypedDataRequest) => Promise<Hex>;
  };
};

/** The External wallet as the signing path sees it: its own address and its client. */
export type FluentSigningWallet = {
  address?: string;
  walletClient?: Pick<WalletClient, "account" | "signMessage" | "signTypedData">;
};

export type FluentSignExecutor = {
  account: FluentWidgetAccount;
  /** Origin of the page requesting the signature, shown in the review. */
  origin: string;
  /**
   * Quick sign, the same preference that governs transactions. On, a Fluent ID
   * signs without the review and through the silent kernel; off, the review is
   * shown and the prompting kernel signs. Never applies to an External wallet.
   */
  silentSigning: boolean;
  /** Resolves when the user confirms the review, rejects when they dismiss it. */
  confirm: (review: FluentSignatureReview) => Promise<void>;
  /**
   * Smart account only: the kernel for this signature's signing mode — `"silent"` under
   * Quick sign, `"prompt"` otherwise. Both are built on the root Signer for a Fluent ID.
   */
  ensureReady: (options: { confirmation: FluentSigningMode }) => Promise<FluentSigningKernel>;
  /** External wallet only; `undefined` while none is connected. */
  wallet?: FluentSigningWallet;
};

/**
 * The signatures of the Widget API, for the Widget account. A Fluent ID shows the Review in
 * Prompt mode and none in Silent mode; an External wallet always shows the Review, then its own
 * prompt.
 */
export type FluentSignApi = {
  /**
   * EIP-191 signature. ERC-1271 (ERC-6492 before deployment) for a smart account, ECDSA for an
   * External wallet.
   *
   * @throws `FluentReviewRejectedError` with `code` `signature_review_rejected` when the person
   * dismisses the Review: always shown for an External wallet, and for a Fluent ID unless Quick
   * sign is on. An External wallet's refusal in its own prompt rejects with the wallet's error.
   * @throws `FluentAuthError` with `code` `not_connected` when no Widget account is connected or
   * the External wallet has no client, and `root_signer_required` when neither of the Fluent
   * ID's signing paths signs with its root Signer, a guard no configuration reaches today.
   *
   * @example
   * ```ts
   * import { useFluentWidget } from "@fluent.xyz/connect";
   *
   * export function useSignGreeting() {
   *   const { widget } = useFluentWidget();
   *   return () => widget.signMessage({ message: "Sign in to Marketplace" });
   * }
   * ```
   */
  signMessage: (params: { message: SignableMessage }) => Promise<Hex>;
  /**
   * EIP-712 signature. ERC-1271 (ERC-6492 before deployment) for a smart account, ECDSA for an
   * External wallet.
   *
   * @throws `FluentReviewRejectedError` with `code` `signature_review_rejected` when the person
   * dismisses the Review, as for `signMessage`.
   * @throws `FluentAuthError` with `code` `not_connected` or `root_signer_required`, as for
   * `signMessage`.
   *
   * @example
   * ```ts
   * import { useFluentWidget } from "@fluent.xyz/connect";
   *
   * const verifyingContract = "0x0000000000000000000000000000000000000001";
   * const order = { maker: "0x0000000000000000000000000000000000000002", price: 100n } as const;
   *
   * export function useSignOrder() {
   *   const { widget } = useFluentWidget();
   *   return () =>
   *     widget.signTypedData({
   *       domain: { name: "Marketplace", version: "1", chainId: 20994, verifyingContract },
   *       types: {
   *         Order: [
   *           { name: "maker", type: "address" },
   *           { name: "price", type: "uint256" },
   *         ],
   *       },
   *       primaryType: "Order",
   *       message: order,
   *     });
   * }
   * ```
   */
  signTypedData: <
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
  >(
    typedData: TypedDataDefinition<typedData, primaryType>,
  ) => Promise<Hex>;
};

type Signer = {
  /** The address the signature is for; shown in the review. */
  address: Address;
  /** Whether to show the review before signing. Off for a Fluent ID under Quick sign. */
  review: boolean;
  /** Produces the signature; resolved only after the user confirmed. */
  resolve: () => Promise<FluentSigningKernel["account"]>;
};

/**
 * Signs as the External wallet's own account. Not `FluentWidgetAccount.address`: that
 * prefers a Fluent smart-account address while one is known, even when the External
 * wallet is the account that executes.
 */
function externalWalletSigner(wallet: FluentSigningWallet): Signer | null {
  const walletClient = wallet.walletClient;
  const account = walletClient?.account ?? (wallet.address as Address | undefined);
  if (!walletClient || !account) return null;
  const address = typeof account === "string" ? account : account.address;
  return {
    address,
    // Quick sign is a Fluent ID preference; an External wallet always reviews, then
    // shows its own prompt.
    review: true,
    async resolve() {
      return {
        signMessage: ({ message }) => walletClient.signMessage({ account, message }),
        signTypedData: (typedData) => walletClient.signTypedData({ account, ...typedData }),
      };
    },
  };
}

export function createFluentSignApi(executor: FluentSignExecutor): FluentSignApi {
  const smartAccountSigner = (): Signer => ({
    address: executor.account.address as Address,
    review: !executor.silentSigning,
    async resolve() {
      // Quick sign on resolves to the silent kernel, off to the prompt one. Both are
      // built on the root Privy Signer for a Fluent ID, which is the only key allowed to
      // sign on the account's behalf. The silent kernel can instead be a permission
      // session where one is configured, and that never signs for the account — so when
      // it is not the root Signer, fall back to the prompt kernel, which always is.
      const confirmation: FluentSigningMode = executor.silentSigning ? "silent" : "prompt";
      const kernel = await executor.ensureReady({ confirmation });
      if (kernel.signerSource === "privy") return kernel.account;
      if (confirmation === "silent") {
        const prompted = await executor.ensureReady({ confirmation: "prompt" });
        if (prompted.signerSource === "privy") return prompted.account;
      }
      throw new FluentAuthError(
        "root_signer_required",
        "Only the Fluent ID root signer can sign for the smart account.",
      );
    },
  });

  /** Which account signs, decided before the review so the review names it. */
  const pickSigner = (): Signer => {
    if (executor.account.type === "smart" && executor.account.address) return smartAccountSigner();
    if (executor.account.type === "eoa") {
      const signer = executor.wallet ? externalWalletSigner(executor.wallet) : null;
      if (!signer) throw new FluentAuthError("not_connected", "External wallet has no signer.");
      return signer;
    }
    throw new FluentAuthError("not_connected", "Connect a Fluent ID or an External wallet first.");
  };

  return {
    async signMessage({ message }) {
      const signer = pickSigner();
      if (signer.review) {
        await executor.confirm({
          kind: "message",
          origin: executor.origin,
          account: executor.account,
          address: signer.address,
          message,
        });
      }
      return (await signer.resolve()).signMessage({ message });
    },
    async signTypedData(typedData) {
      const signer = pickSigner();
      // Erase the host's generics once; see `FluentTypedDataRequest`.
      const request = typedData as FluentTypedDataRequest;
      if (signer.review) {
        await executor.confirm({
          kind: "typedData",
          origin: executor.origin,
          account: executor.account,
          address: signer.address,
          typedData: request,
        });
      }
      return (await signer.resolve()).signTypedData(request);
    },
  };
}
