import type {
  Address,
  Hex,
  SignableMessage,
  TypedData,
  TypedDataDefinition,
  WalletClient,
} from "viem";

import { FluentAuthError } from "../core/authToken";
import type { FluentWidgetAuthMode } from "../core/config";
import type { FluentWidgetAccount } from "./batchOperation";
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
  authMode: FluentWidgetAuthMode;
  account: FluentWidgetAccount;
  /** Origin of the page requesting the signature, shown in the review. */
  origin: string;
  /** Resolves when the user confirms the review, rejects when they dismiss it. */
  confirm: (review: FluentSignatureReview) => Promise<void>;
  /** Smart account only: the prompt-mode kernel, whose signer is the root Signer. */
  ensureReady: (options: { confirmation: "always" }) => Promise<FluentSigningKernel>;
  /** External wallet only; `undefined` while none is connected. */
  wallet?: FluentSigningWallet;
};

export type FluentSignApi = {
  /** EIP-191 signature. ERC-1271 (ERC-6492 before deployment) for a smart account, ECDSA for an External wallet. */
  signMessage: (params: { message: SignableMessage }) => Promise<Hex>;
  /** EIP-712 signature. ERC-1271 (ERC-6492 before deployment) for a smart account, ECDSA for an External wallet. */
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
    async resolve() {
      return {
        signMessage: ({ message }) => walletClient.signMessage({ account, message }),
        signTypedData: (typedData) => walletClient.signTypedData({ account, ...typedData }),
      };
    },
  };
}

export function createFluentSignApi(executor: FluentSignExecutor): FluentSignApi {
  const assertDirectMode = () => {
    if (executor.authMode === "hosted") {
      throw new FluentAuthError(
        "hosted_not_supported",
        'Signing needs authMode: "direct" — there is no hosted signer to ask.',
      );
    }
  };

  const smartAccountSigner = (): Signer => ({
    address: executor.account.address as Address,
    async resolve() {
      // "always" resolves to the prompt kernel, which is built on the root Signer; the
      // silent kernel may be a permission session and never signs on the account's behalf.
      const kernel = await executor.ensureReady({ confirmation: "always" });
      if (kernel.signerSource !== "privy") {
        throw new FluentAuthError(
          "root_signer_required",
          "Only the Fluent ID root signer can sign for the smart account.",
        );
      }
      return kernel.account;
    },
  });

  /** Which account signs, decided before the review so the review names it. */
  const pickSigner = (): Signer => {
    assertDirectMode();
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
      await executor.confirm({
        kind: "message",
        origin: executor.origin,
        account: executor.account,
        address: signer.address,
        message,
      });
      return (await signer.resolve()).signMessage({ message });
    },
    async signTypedData(typedData) {
      const signer = pickSigner();
      // Erase the host's generics once; see `FluentTypedDataRequest`.
      const request = typedData as FluentTypedDataRequest;
      await executor.confirm({
        kind: "typedData",
        origin: executor.origin,
        account: executor.account,
        address: signer.address,
        typedData: request,
      });
      return (await signer.resolve()).signTypedData(request);
    },
  };
}
