/**
 * A `FluentPrivyAdapter` that runs in the page with no Privy behind it, mirroring
 * `@privy-io/react-auth` 2.25.0 for the paths the widget takes: email login, the
 * Signer that `createOnLogin: "users-without-wallets"` creates after it, and the
 * EIP-1193 provider that Signer exposes. Every hook the adapter type lists is
 * implemented, because a missing one silently falls back to real Privy.
 *
 * The Signer is a viem local account on a published development key, so its
 * signatures are real and the address the widget derives from it is stable.
 */
import type { FluentPrivyAdapter } from "@fluent.xyz/connect";
import { useSyncExternalStore, type ReactNode } from "react";
import { numberToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Anvil's first development key: public, so nothing is lost by shipping it. */
const SIGNER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const signer = privateKeyToAccount(SIGNER_KEY);

/** The only code `loginWithCode` accepts, the way a Privy test account has one fixed code. */
export const FAKE_PRIVY_CODE = "123456";

type FakeLinkedAccount = {
  type: "email" | "wallet";
  address: string;
  chainType?: "ethereum";
  walletClientType?: "privy";
  connectorType?: "embedded";
};

type FakeUser = {
  id: string;
  email?: { address: string };
  linkedAccounts: FakeLinkedAccount[];
};

type FakeState = {
  ready: boolean;
  authenticated: boolean;
  user: FakeUser | null;
  hasSigner: boolean;
  pendingEmail: string | null;
};

export type FakePrivyOptions = {
  /** Start with this email already signed in and its Signer created, as a restored session. */
  signedInAs?: string;
  /** The chain the Signer's provider reports; the widget switches it when it differs. */
  chainId: number;
};

const listeners = new Set<() => void>();
let state: FakeState = {
  ready: false,
  authenticated: false,
  user: null,
  hasSigner: false,
  pendingEmail: null,
};
let walletChainId = 0;

function setState(patch: Partial<FakeState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useFakeState() {
  return useSyncExternalStore(subscribe, () => state);
}

function signerLinkedAccount(): FakeLinkedAccount {
  return {
    type: "wallet",
    address: signer.address,
    chainType: "ethereum",
    walletClientType: "privy",
    connectorType: "embedded",
  };
}

function userFor(email: string, withSigner: boolean): FakeUser {
  const linkedAccounts: FakeLinkedAccount[] = [{ type: "email", address: email }];
  if (withSigner) linkedAccounts.push(signerLinkedAccount());
  return { id: `did:privy:e2e-${email}`, email: { address: email }, linkedAccounts };
}

function createSigner() {
  if (state.hasSigner || !state.user) return;
  setState({
    hasSigner: true,
    user: { ...state.user, linkedAccounts: [...state.user.linkedAccounts, signerLinkedAccount()] },
  });
}

/** What every request the widget sends the Signer's provider is answered with. */
async function providerRequest({ method, params }: { method: string; params?: unknown[] }) {
  switch (method) {
    case "eth_chainId":
      return numberToHex(walletChainId);
    case "eth_accounts":
    case "eth_requestAccounts":
      return [signer.address];
    case "wallet_switchEthereumChain": {
      const [{ chainId }] = params as [{ chainId: Hex }];
      walletChainId = Number(chainId);
      return null;
    }
    case "personal_sign": {
      const [message] = params as [Hex];
      return signer.signMessage({ message: { raw: message } });
    }
    case "eth_signTypedData_v4": {
      const [, json] = params as [string, string];
      return signer.signTypedData(JSON.parse(json));
    }
    default:
      throw Object.assign(new Error(`fake Privy provider: ${method} is not supported`), {
        code: 4200,
      });
  }
}

const signerWallet = {
  address: signer.address,
  walletClientType: "privy",
  chainType: "ethereum",
  getEthereumProvider: async () => ({ request: providerRequest }),
  switchChain: async (chainId: number) => {
    walletChainId = chainId;
  },
};

function noop() {}
async function asyncNoop() {}

const PrivyProvider = ({ children }: { children?: ReactNode }) => <>{children}</>;

export function createFakePrivyAdapter(options: FakePrivyOptions): FluentPrivyAdapter {
  walletChainId = options.chainId;
  state = {
    ready: false,
    authenticated: Boolean(options.signedInAs),
    user: options.signedInAs ? userFor(options.signedInAs, true) : null,
    hasSigner: Boolean(options.signedInAs),
    pendingEmail: null,
  };
  // Real Privy reports `ready` only after its own mount effect has restored the session.
  queueMicrotask(() => setState({ ready: true }));

  const adapter = {
    PrivyProvider,
    Captcha: () => null,
    usePrivy: () => {
      const current = useFakeState();
      return {
        ready: current.ready,
        authenticated: current.authenticated,
        user: current.user,
        getAccessToken: async () => (current.authenticated ? "e2e-privy-access-token" : null),
        login: noop,
        logout: async () => {
          setState({ authenticated: false, user: null, hasSigner: false, pendingEmail: null });
        },
        unlinkPasskey: asyncNoop,
      };
    },
    useWallets: () => {
      const current = useFakeState();
      return { ready: current.ready, wallets: current.hasSigner ? [signerWallet] : [] };
    },
    useIdentityToken: () => {
      const current = useFakeState();
      return { identityToken: current.authenticated ? "e2e.identity-token.signature" : null };
    },
    useUser: () => ({ user: useFakeState().user, refreshUser: asyncNoop }),
    useLinkAccount: () => ({ linkTwitter: noop }),
    useLinkWithPasskey: () => ({ linkWithPasskey: asyncNoop }),
    useLoginWithSiwe: () => ({
      generateSiweMessage: async () => "",
      loginWithSiwe: asyncNoop,
    }),
    useModalStatus: () => ({ isOpen: false }),
    useCreateWallet: () => ({
      createWallet: async () => {
        createSigner();
        return signerWallet;
      },
    }),
    useLoginWithEmail: () => ({
      state: { status: "initial" },
      sendCode: async ({ email }: { email: string }) => {
        setState({ pendingEmail: email });
      },
      loginWithCode: async ({ code }: { code: string }) => {
        if (!state.pendingEmail) throw new Error("No code was sent.");
        if (code !== FAKE_PRIVY_CODE) throw new Error("Invalid code. Please try again.");
        const email = state.pendingEmail;
        setState({ authenticated: true, user: userFor(email, false), pendingEmail: null });
        // `createOnLogin: "users-without-wallets"`: the Signer follows the login, not with it.
        setTimeout(createSigner, 0);
        return state.user;
      },
    }),
    useLoginWithOAuth: () => ({ state: { status: "initial" }, initOAuth: asyncNoop }),
    useLoginWithPasskey: () => ({ loginWithPasskey: asyncNoop }),
    useSignMessage: () => ({
      signMessage: async ({ message }: { message: string }) => ({
        signature: await signer.signMessage({
          message: message.startsWith("0x") ? { raw: message as Hex } : message,
        }),
      }),
    }),
    useSignTypedData: () => ({
      signTypedData: async (typedData: Parameters<typeof signer.signTypedData>[0]) => ({
        signature: await signer.signTypedData(typedData),
      }),
    }),
  };
  // The fake implements the parts of each hook's result the widget reads, not Privy's whole
  // surface, so it is checked against the adapter's keys rather than its full types.
  return (adapter satisfies Record<keyof FluentPrivyAdapter, unknown>) as unknown as
    FluentPrivyAdapter;
}

export const FAKE_SIGNER_ADDRESS = signer.address;
