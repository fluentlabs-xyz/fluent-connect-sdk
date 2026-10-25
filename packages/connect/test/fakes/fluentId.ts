/**
 * The external boundaries a Fluent ID's widget reaches, faked for the tests that run every module
 * of this repository for real (`docs/standards/testing.md` T3, T4): `zerodevSession.ts`,
 * `reownAppKit.tsx`, `core/settingsClient.ts`, `core/authToken.ts` and the rest of the send.
 *
 * A test file mocks the SDK modules with the factories below and stubs `fetch` with
 * `stubNetwork()`; `boundary` is what each case scripts and reads back. What is faked, and the
 * version whose contract each fake mirrors:
 *
 * - `@privy-io/react-auth` 2.25.0 (`privyModule`): a signed-in user, ready, with an identity
 *   token and one Signer in `useWallets` (`walletClientType: "privy"`), or nobody signed in.
 *   The Signer's EIP-1193 provider answers `eth_chainId` with the widget chain and signs
 *   `personal_sign` / `eth_signTypedData_v4` with `PROVIDER_SIGNATURE`, which is how the silent
 *   kernel signs; `useSignMessage` / `useSignTypedData` answer `PROMPT_SIGNATURE`, which is how
 *   the prompting kernel signs. Objects keep their identity across renders, as Privy's do.
 * - `@zerodev/ecdsa-validator` 5.4.9 `signerToEcdsaValidator` and `@zerodev/sdk` 5.5.10
 *   `createKernelAccount` (`zerodevValidatorModule`, `zerodevSdkModule`): the smart account
 *   at `SMART_ACCOUNT`, which signs a user operation, a message and typed data by asking its
 *   sudo validator's signer, as the one `createKernelAccount` derives does (the ERC-1271
 *   wrapping a real one adds changes no request the Signer makes). The rest of `@zerodev/sdk`,
 *   `createKernelAccountClient` and the ZeroDev paymaster client included, and viem's
 *   user-operation actions run for real.
 * - `@reown/appkit/react` 1.8.20 (`reownAppKitModule`): `createAppKit` and `useAppKit`, the
 *   modal only; `@reown/appkit-adapter-wagmi` and wagmi run for real.
 * - `fetch` (`stubNetwork`), told apart by URL: the widget chain's JSON-RPC (viem 2.52.0
 *   `http()`), the ZeroDev bundler's and ERC-20 paymaster's JSON-RPC, the sponsorship
 *   paymaster, and fluent-connect-service `dda9976` (`POST /auth/exchange/privy`,
 *   `GET /me/settings`). The chain shows an operation's `UserOperationEvent` on the first
 *   `eth_getLogs` and the bundler its receipt on the first `eth_getUserOperationReceipt`, a
 *   receipt only after its hash, so no case waits on a poll. Any other request gets the
 *   JSON-RPC answer `"0x0"`: balances and prices are not what these tests are about.
 */
import { vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  numberToHex,
  parseAbiItem,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
  type SignableMessage,
} from "viem";

export const CHAIN_ID = 20994;
export const ENTRY_POINT = getAddress("0x0000000071727de22e5e9d8baf0edac6f37da032");
export const SMART_ACCOUNT = getAddress("0x092AE7564C6611a114C20C6df766B5B35A52334A");
export const SIGNER = getAddress("0x1111111111111111111111111111111111111111");
export const PRIVY_USER = "did:privy:fluent-id-owner";
export const PRIVY_IDENTITY_TOKEN = "privy-identity-token";
/** The paymaster the sponsorship proxy names when it sponsors an operation. */
export const PAYMASTER = getAddress("0x991e4158e338283d7efbc37eb49491a21434d964");
/** The paymaster ZeroDev's ERC-20 endpoint names for a Gas token send. */
export const ERC20_PAYMASTER = getAddress("0x5555555555555555555555555555555555555555");
export const USER_OP_HASH = `0x${"aa".repeat(32)}` as Hash;
export const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as Hash;
const BLOCK_HASH = `0x${"dd".repeat(32)}` as Hash;
const ANCHOR_BLOCK = 500n;
const INCLUDED_BLOCK = 502n;
/** What the Signer's provider signs with: the silent kernel's path. */
export const PROVIDER_SIGNATURE = `0x${"11".repeat(65)}` as Hex;
/** What Privy's `useSignMessage` / `useSignTypedData` sign with: the prompting kernel's path. */
export const PROMPT_SIGNATURE = `0x${"22".repeat(65)}` as Hex;

/** How the sponsorship paymaster answers `zd_sponsorUserOperation`. */
export type SponsorshipAnswer = "sponsors" | "denies" | 401 | 403 | 404;

export type Boundary = {
  /** Whether Privy has a signed-in user with a Signer. */
  signedIn: boolean;
  /** The Quick sign `GET /me/settings` answers; `null` makes it answer 500. */
  quickSign: boolean | null;
  /** One answer per `POST /auth/exchange/privy`, the last repeated: a token, or a status. */
  exchanges: Array<"token" | 401>;
  sponsorship: SponsorshipAnswer;
  /** One answer per `eth_sendUserOperation`, the last repeated. */
  submissions: Array<"accept" | "reject">;
  /**
   * Who paid, as the settled operation shows it: the paymaster on the bundler's receipt and in
   * the chain's `UserOperationEvent`, the zero address for the account itself, or `null` for a
   * bundler receipt with no `paymaster` field and no event in its logs.
   */
  paidBy: Address | null;
  /** What reached each boundary, in order. */
  requests: Array<{ endpoint: Endpoint; method: string }>;
  providerRequests: string[];
  promptSignatures: number;
};

type Endpoint = "chain" | "bundler" | "sponsorship" | "service" | "other";

export const boundary: Boundary = freshBoundary();

function freshBoundary(): Boundary {
  return {
    signedIn: true,
    quickSign: null,
    exchanges: ["token"],
    sponsorship: "sponsors",
    submissions: ["accept"],
    paidBy: zeroAddress,
    requests: [],
    providerRequests: [],
    promptSignatures: 0,
  };
}

/** Every case starts from a signed-in Fluent ID whose operations its own account pays for. */
export function resetBoundary(script: Partial<Boundary> = {}): void {
  Object.assign(boundary, freshBoundary(), script);
}

/** The Signer's EIP-1193 provider, as Privy's `getEthereumProvider()` hands it out. */
const signerProvider = {
  request: async ({ method }: { method: string; params?: unknown[] }) => {
    boundary.providerRequests.push(method);
    if (method === "eth_chainId") return numberToHex(CHAIN_ID);
    if (method === "personal_sign" || method === "eth_signTypedData_v4") return PROVIDER_SIGNATURE;
    throw new Error(`the Signer's provider has no method ${method}`);
  },
};

const signerWallet = {
  address: SIGNER,
  walletClientType: "privy",
  connectorType: "embedded",
  getEthereumProvider: async () => signerProvider,
  switchChain: async () => undefined,
};

const privyUser = { id: PRIVY_USER, linkedAccounts: [] };
const signedOut = { ready: true, wallets: [] as unknown[] };
const signedInWallets = { ready: true, wallets: [signerWallet] };
const promptSign = async () => {
  boundary.promptSignatures += 1;
  return { signature: PROMPT_SIGNATURE };
};
const signMessageHook = { signMessage: promptSign };
const signTypedDataHook = { signTypedData: promptSign };

/** The `@privy-io/react-auth` module, for `vi.mock`. */
export function privyModule(): Record<string, unknown> {
  const noop = () => {};
  return {
    PrivyProvider: ({ children }: { children: unknown }) => children,
    usePrivy: () => ({
      ready: true,
      authenticated: boundary.signedIn,
      user: boundary.signedIn ? privyUser : null,
      getAccessToken: async () => (boundary.signedIn ? "privy-access-token" : null),
      login: noop,
      // As Privy's: the user is signed out once it resolves.
      logout: async () => {
        boundary.signedIn = false;
      },
    }),
    useIdentityToken: () => ({
      identityToken: boundary.signedIn ? PRIVY_IDENTITY_TOKEN : null,
    }),
    useWallets: () => (boundary.signedIn ? signedInWallets : signedOut),
    useSignMessage: () => signMessageHook,
    useSignTypedData: () => signTypedDataHook,
    useUser: () => ({ refreshUser: async () => {} }),
    useLinkAccount: () => ({ linkTwitter: noop }),
    useLinkWithPasskey: () => ({ linkWithPasskey: noop }),
    useLoginWithSiwe: () => ({ generateSiweMessage: noop, loginWithSiwe: noop }),
    useModalStatus: () => ({ isOpen: false }),
    useCreateWallet: () => ({ createWallet: noop }),
    useLoginWithEmail: () => ({ sendCode: noop, loginWithCode: noop }),
    useLoginWithOAuth: () => ({ initOAuth: noop, state: { status: "initial" } }),
    useLoginWithPasskey: () => ({ loginWithPasskey: noop }),
    Captcha: () => null,
  };
}

type Signer = {
  signMessage: (params: { message: SignableMessage }) => Promise<Hex>;
  signTypedData: (params: never) => Promise<Hex>;
};

/** The `@zerodev/ecdsa-validator` module, for `vi.mock`: the validator keeps its signer. */
export function zerodevValidatorModule(actual: Record<string, unknown>): Record<string, unknown> {
  return {
    ...actual,
    signerToEcdsaValidator: async (_client: unknown, params: { signer: Signer }) => ({
      signer: params.signer,
    }),
  };
}

/** The `@zerodev/sdk` module, for `vi.mock`: the derived smart account, and the real rest. */
export function zerodevSdkModule(actual: Record<string, unknown>): Record<string, unknown> {
  return {
    ...actual,
    createKernelAccount: async (
      _client: unknown,
      params: { plugins: { sudo: { signer: Signer } } },
    ) => {
      const { signer } = params.plugins.sudo;
      return {
        address: SMART_ACCOUNT,
        type: "smart" as const,
        entryPoint: { address: ENTRY_POINT, version: "0.7" as const },
        getFactoryArgs: async () => ({}),
        encodeCalls: async () => "0x1234" as Hex,
        getNonce: async () => 9n,
        getStubSignature: async () => PROVIDER_SIGNATURE,
        signUserOperation: async () => signer.signMessage({ message: { raw: USER_OP_HASH } }),
        signMessage: ({ message }: { message: SignableMessage }) => signer.signMessage({ message }),
        signTypedData: (typedData: never) => signer.signTypedData(typedData),
      };
    },
  };
}

/** The `@reown/appkit/react` module, for `vi.mock`: the modal, which never opens here. */
export function reownAppKitModule(): Record<string, unknown> {
  return {
    createAppKit: () => ({}),
    useAppKit: () => ({ open: async () => {} }),
  };
}

const USER_OPERATION_EVENT = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, " +
    "address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, " +
    "uint256 actualGasUsed)",
);

function userOperationEvent(paymaster: Address) {
  return {
    address: ENTRY_POINT,
    topics: encodeEventTopics({
      abi: [USER_OPERATION_EVENT],
      args: { userOpHash: USER_OP_HASH, sender: SMART_ACCOUNT, paymaster },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [9n, true, 5_000_000_000_000n, 120_000n],
    ),
    blockNumber: numberToHex(INCLUDED_BLOCK),
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x1",
    logIndex: "0x0",
    removed: false,
  };
}

function transactionReceipt() {
  return {
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x1",
    blockHash: BLOCK_HASH,
    blockNumber: numberToHex(INCLUDED_BLOCK),
    from: SMART_ACCOUNT,
    to: ENTRY_POINT,
    cumulativeGasUsed: numberToHex(200_000n),
    gasUsed: numberToHex(150_000n),
    contractAddress: null,
    logs: boundary.paidBy === null ? [] : [userOperationEvent(boundary.paidBy)],
    logsBloom: `0x${"0".repeat(512)}`,
    status: "0x1",
    type: "0x2",
    effectiveGasPrice: numberToHex(1_000_000_000n),
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const rpcResult = (id: unknown, result: unknown) => json(200, { jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, message: string) =>
  json(200, { jsonrpc: "2.0", id, error: { code: -32602, message } });

/** The gas fields both paymasters return with their data (entry point 0.7). */
function paymasterData(paymaster: Address) {
  return {
    paymaster,
    paymasterData: "0x",
    paymasterVerificationGasLimit: numberToHex(60_000n),
    paymasterPostOpGasLimit: numberToHex(40_000n),
    callGasLimit: numberToHex(100_000n),
    verificationGasLimit: numberToHex(80_000n),
    preVerificationGas: numberToHex(50_000n),
  };
}

let submission = 0;
let exchange = 0;

function answerChain(id: unknown, method: string): Response {
  if (method === "eth_chainId") return rpcResult(id, numberToHex(CHAIN_ID));
  if (method === "eth_blockNumber") return rpcResult(id, numberToHex(ANCHOR_BLOCK));
  if (method === "eth_gasPrice") return rpcResult(id, numberToHex(1_000_000_000n));
  if (method === "eth_getLogs") {
    return rpcResult(id, boundary.paidBy === null ? [] : [userOperationEvent(boundary.paidBy)]);
  }
  if (method === "eth_getTransactionReceipt") return rpcResult(id, transactionReceipt());
  if (method === "eth_getBlockByNumber") {
    return rpcResult(id, {
      number: numberToHex(INCLUDED_BLOCK),
      timestamp: numberToHex(1_700_000_000n),
    });
  }
  return rpcResult(id, "0x0");
}

function answerBundler(id: unknown, method: string): Response {
  if (method === "eth_chainId") return rpcResult(id, numberToHex(CHAIN_ID));
  if (method === "eth_estimateUserOperationGas") {
    return rpcResult(id, {
      callGasLimit: numberToHex(100_000n),
      preVerificationGas: numberToHex(50_000n),
      verificationGasLimit: numberToHex(80_000n),
    });
  }
  if (method === "zd_sponsorUserOperation") return rpcResult(id, paymasterData(ERC20_PAYMASTER));
  if (method === "eth_sendUserOperation") {
    const next = boundary.submissions[submission] ?? boundary.submissions.at(-1);
    submission += 1;
    if (next === "reject") return rpcError(id, "AA21 didn't pay prefund");
    return rpcResult(id, USER_OP_HASH);
  }
  if (method === "eth_getUserOperationReceipt") {
    if (submission === 0) return rpcResult(id, null);
    return rpcResult(id, {
      userOpHash: USER_OP_HASH,
      entryPoint: ENTRY_POINT,
      sender: SMART_ACCOUNT,
      nonce: numberToHex(9n),
      success: true,
      ...(boundary.paidBy === null ? {} : { paymaster: boundary.paidBy }),
      actualGasCost: numberToHex(5_000_000_000_000n),
      actualGasUsed: numberToHex(120_000n),
      logs: boundary.paidBy === null ? [] : [userOperationEvent(boundary.paidBy)],
      receipt: transactionReceipt(),
    });
  }
  throw new Error(`the bundler has no method ${method}`);
}

function answerSponsorship(id: unknown): Response {
  const answer = boundary.sponsorship;
  if (answer === "sponsors") return rpcResult(id, paymasterData(PAYMASTER));
  if (answer === "denies") return rpcError(id, "the App's sponsorship policy denies this call");
  return json(answer, { code: "sponsorship_refused", message: "refused" });
}

function answerService(path: string): Response {
  if (path.endsWith("/auth/exchange/privy")) {
    const next = boundary.exchanges[exchange] ?? boundary.exchanges.at(-1);
    exchange += 1;
    if (next === 401) return json(401, { code: "invalid_privy_token", message: "expired" });
    return json(200, { token: `fluent.token.${exchange}` });
  }
  if (path.endsWith("/me/settings")) {
    if (boundary.quickSign === null) return json(500, { code: "internal", message: "down" });
    return json(200, { quick_sign: boundary.quickSign, gas_token_symbol: null, tokens: [] });
  }
  return rpcResult(1, "0x0");
}

function endpointOf(url: URL): Endpoint {
  if (url.hostname === "rpc.zerodev.app") return "bundler";
  if (url.pathname.includes("/paymaster/")) return "sponsorship";
  if (/\/(auth|me)\//.test(url.pathname)) return "service";
  return "other";
}

/**
 * Node's `Request`, minus the abort signal. viem's `http()` builds a `Request` before it calls
 * `fetch`, with an `AbortController` the jsdom environment supplies, and Node's `Request`
 * refuses jsdom's `AbortSignal`, so under jsdom every request fails before it reaches `fetch`.
 * Nothing here is ever aborted: the fake `fetch` answers at once.
 */
const NodeRequest = globalThis.Request;
class RequestWithoutSignal extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, { ...init, signal: undefined });
  }
}

/** Stubs `fetch` with the endpoints above, from a fresh count of submissions and exchanges. */
export function stubNetwork(): void {
  submission = 0;
  exchange = 0;
  vi.stubGlobal("Request", RequestWithoutSignal);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "object" && "url" in input ? input.url : String(input);
      const url = new URL(href, "http://localhost");
      const raw = typeof init?.body === "string" ? init.body : undefined;
      const body = raw ? (JSON.parse(raw) as { id?: unknown; method?: unknown }) : undefined;
      const rpcMethod = typeof body?.method === "string" ? body.method : undefined;
      let endpoint = endpointOf(url);
      if (endpoint === "other" && rpcMethod) endpoint = "chain";
      boundary.requests.push({ endpoint, method: rpcMethod ?? url.pathname });
      if (endpoint === "bundler") return answerBundler(body?.id, rpcMethod ?? "");
      if (endpoint === "sponsorship") return answerSponsorship(body?.id);
      if (endpoint === "chain") return answerChain(body?.id, rpcMethod ?? "");
      return answerService(url.pathname);
    }),
  );
}

/** The JSON-RPC methods that reached one endpoint, in order. */
export function methodsAt(endpoint: Endpoint): string[] {
  return boundary.requests.filter((request) => request.endpoint === endpoint).map((r) => r.method);
}
