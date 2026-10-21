/**
 * One smart-account send through the widget, with the chain answering what ZeroDev used to.
 *
 * `sendCalls` lives inside `useFluentZeroDevAccount`, so it is read out of `zerodevSession.ts`
 * and run with its free variables supplied — the way `executionReceipt.test.ts` and
 * `zerodevSession.readyKernel.test.ts` do it, and for the same reason: rendering the hook would
 * need Privy, a bundler and a chain, and what is under test here is the send. Every free
 * variable `sendCalls` reaches for has to appear in the sandbox below; one it grows and the
 * sandbox lacks is a `ReferenceError` at the first send, not a compile error.
 *
 * The module's own functions are not retold here: the same file is loaded a second time as a
 * CommonJS module in a vm, so `createFluentZeroDevKernelClient`, the two Signer adapters,
 * `createFluentZeroDevErc20ExecutionClient` and `readUserOperationPaymaster` are the widget's
 * own, and the kernel clients these tests send through carry the fee hook because the widget's
 * constructor put it there.
 *
 * Fakes, and nothing else:
 * - the two JSON-RPC transports, the widget chain's and the ZeroDev bundler's, as `viem@2.52.0`
 *   `custom()` transports answering the methods the real endpoints answer, with
 *   `core/rpc.ts`'s retry count;
 * - the Signer: a Privy embedded wallet and its EIP-1193 provider, and Privy's `signMessage` /
 *   `signTypedData` hooks;
 * - the smart account, which signs a user operation by asking that Signer to sign its hash, as
 *   a Kernel account's sudo validator does (`@zerodev/ecdsa-validator@5.4.5`).
 *
 * `viem`'s `prepareUserOperation`, `sendUserOperation` and `waitForUserOperationReceipt`,
 * `@zerodev/sdk@5.5.10`'s `createKernelAccountClient`, and every module of this repository the
 * send reaches run for real.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import * as react from "react";
import * as viem from "viem";
import * as viemAccounts from "viem/accounts";
import * as zerodevSdk from "@zerodev/sdk";
import * as zerodevConstants from "@zerodev/sdk/constants";
import * as ecdsaValidator from "@zerodev/ecdsa-validator";
import * as permissions from "@zerodev/permissions";
import * as permissionPolicies from "@zerodev/permissions/policies";
import * as permissionSigners from "@zerodev/permissions/signers";
import {
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  numberToHex,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import type { SmartAccount } from "viem/account-abstraction";

import * as config from "../core/config";
import * as debugLogger from "../core/debugLogger";
import * as gasPayment from "../core/gasPayment";
import * as rpc from "../core/rpc";
import * as sponsoredClient from "../core/sponsoredClient";
import * as sponsorshipFailure from "../core/sponsorshipFailure";
import * as userOperationFees from "../core/userOperationFees";
import * as userOperationGas from "../core/userOperationGas";
import * as userOperationReceipt from "../core/userOperationReceipt";
import * as userOperationTiming from "../core/userOperationTiming";
import * as utils from "../utils";
import * as zerodevPaymaster from "../core/zerodevPaymaster";
import * as privyAdapter from "./privyAdapter";
import * as widgetNetworkContext from "./widgetNetworkContext";
import type { FluentExecuteResult } from "./batchOperation";
import type { ResolvedFluentWidgetExecution } from "../core/config";

const ENTRY_POINT = getAddress("0x0000000071727de22e5e9d8baf0edac6f37da032");
const SMART_ACCOUNT = getAddress("0x092ae7564c6611a114c20c6df766b5b35a52334a");
const SIGNER = getAddress("0x1111111111111111111111111111111111111111");
const PAYMASTER = getAddress("0x991e4158e338283d7efbc37eb49491a21434d964");
const TARGET = getAddress("0x3333333333333333333333333333333333333333");
const USER_OP_HASH = `0x${"aa".repeat(32)}` as Hash;
const SECOND_USER_OP_HASH = `0x${"ab".repeat(32)}` as Hash;
const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as Hash;
const BLOCK_HASH = `0x${"dd".repeat(32)}` as Hash;
const SIGNATURE = `0x${"11".repeat(65)}` as Hex;
const ANCHOR_BLOCK = 500n;
const INCLUDED_BLOCK = 502n;
const CHAIN_GAS_PRICE = 1_000_000_000n;
const BUNDLER_FEES = { maxFeePerGas: 7_000_000_000n, maxPriorityFeePerGas: 3_000_000_000n };
const FEE_REJECTION = "maxFeePerGas must be at least 1100000000";
const CHAIN_RPC_URL = "https://rpc.fluent.test";
const ZERODEV_RPC_URL = "https://rpc.zerodev.app/api/v3/project/chain/20994";
const chain = {
  id: 20994,
  name: "Fluent Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CHAIN_RPC_URL] } },
} as unknown as viem.Chain;
const CALLS = [{ to: TARGET, data: "0x1234" as Hex, value: 0n }];
/** One typed-data request, for the signatures the Signer's chain tests ask for. */
const TYPED_DATA = {
  domain: { name: "Fluent" },
  types: { Message: [{ name: "text", type: "string" }] },
  primaryType: "Message",
  message: { text: "hello" },
} as never;

function compiled(module: ts.ModuleKind) {
  return ts.transpileModule(
    readFileSync(new URL("./zerodevSession.ts", import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module } },
  ).outputText;
}

/** The widget session as a CommonJS module, for the functions it does not export. */
function loadSessionModule() {
  const modules: Record<string, unknown> = {
    react,
    viem,
    "viem/accounts": viemAccounts,
    "@zerodev/sdk": zerodevSdk,
    "@zerodev/sdk/constants": zerodevConstants,
    "@zerodev/ecdsa-validator": ecdsaValidator,
    "@zerodev/permissions": permissions,
    "@zerodev/permissions/policies": permissionPolicies,
    "@zerodev/permissions/signers": permissionSigners,
    "@privy-io/react-auth": {},
    "../core/config": config,
    "../core/debugLogger": debugLogger,
    "../core/gasPayment": gasPayment,
    "../core/rpc": rpc,
    "../core/sponsoredClient": sponsoredClient,
    "../core/sponsorshipFailure": sponsorshipFailure,
    "../core/userOperationFees": userOperationFees,
    "../core/userOperationGas": userOperationGas,
    "../core/userOperationReceipt": userOperationReceipt,
    "../core/userOperationTiming": userOperationTiming,
    "../core/zerodevPaymaster": zerodevPaymaster,
    "../utils": utils,
    "./privyAdapter": privyAdapter,
    "./widgetNetworkContext": widgetNetworkContext,
  };
  const exports: Record<string, unknown> = {};
  return runInNewContext(
    `${compiled(ts.ModuleKind.CommonJS)}
[
  createFluentZeroDevKernelClient,
  createFluentZeroDevErc20ExecutionClient,
  createFluentZeroDevKernel,
  readUserOperationPaymaster,
  toPromptedPrivyLocalAccount,
  toSilentPrivyLocalAccount,
  toFluentSigningAccount,
  withFluentSignerChainCheck,
  readFluentSignerChainCheck,
];`,
    {
      exports,
      module: { exports },
      require: (id: string) => {
        const found = modules[id];
        if (!found) throw new Error(`the sandbox has no module ${id}`);
        return found;
      },
      console,
      performance,
      setTimeout,
      clearTimeout,
    },
  ) as [
    SessionModule["kernelClient"],
    SessionModule["erc20Client"],
    SessionModule["createKernel"],
    SessionModule["readPaymaster"],
    SessionModule["promptedAccount"],
    SessionModule["silentAccount"],
    SessionModule["signingAccount"],
    SessionModule["withChainCheck"],
    SessionModule["readChainCheck"],
  ];
}

type ExecutionReader = () => ResolvedFluentWidgetExecution;
type KernelClient = ReturnType<typeof zerodevSdk.createKernelAccountClient>;
type ClientTarget = {
  account: SmartAccount;
  chain: viem.Chain;
  publicClient: ReturnType<typeof viem.createPublicClient>;
  zeroDevRpcUrl: string;
};
type PrivyWallet = {
  address: string;
  getEthereumProvider: () => Promise<unknown>;
  switchChain?: (id: number | Hex) => Promise<void>;
};
type SessionModule = {
  kernelClient: (params: {
    kernel: ClientTarget;
    readExecution: ExecutionReader;
    paymaster?: unknown;
  }) => KernelClient;
  erc20Client: (
    kernel: ClientTarget,
    gasToken: Address,
    readExecution: ExecutionReader,
  ) => KernelClient;
  createKernel: (params: {
    wallet?: PrivyWallet;
    signerMode: "prompt" | "silent";
    promptedSigners: {
      signMessage: (...args: never[]) => Promise<{ signature: string }>;
      signTypedData: (...args: never[]) => Promise<{ signature: string }>;
    };
    chain: viem.Chain;
    readExecution: ExecutionReader;
  }) => Promise<unknown>;
  readPaymaster: (receipt: unknown) => Address | undefined;
  promptedAccount: (
    wallet: PrivyWallet,
    promptedSigners: {
      signMessage: (...args: never[]) => Promise<{ signature: string }>;
      signTypedData: (...args: never[]) => Promise<{ signature: string }>;
    },
  ) => viemAccounts.Account & {
    signMessage: (params: { message: viem.SignableMessage }) => Promise<Hex>;
    signTypedData: (params: never) => Promise<Hex>;
  };
  silentAccount: (wallet: PrivyWallet) => viemAccounts.Account & {
    signMessage: (params: { message: viem.SignableMessage }) => Promise<Hex>;
    signTypedData: (params: never) => Promise<Hex>;
  };
  /** The kernel's account as every holder of the kernel gets it. */
  signingAccount: <account extends object>(params: {
    account: account;
    wallet: PrivyWallet;
    chain: viem.Chain;
    readExecution: ExecutionReader;
  }) => account;
  withChainCheck: <account extends object>(
    account: account,
    signatures: readonly ("signUserOperation" | "signMessage" | "signTypedData")[],
    before: () => Promise<void>,
  ) => account;
  readChainCheck: (account: unknown) => (() => Promise<void>) | undefined;
};

const [
  createFluentZeroDevKernelClient,
  createFluentZeroDevErc20ExecutionClient,
  createFluentZeroDevKernel,
  readUserOperationPaymaster,
  toPromptedPrivyLocalAccount,
  toSilentPrivyLocalAccount,
  toFluentSigningAccount,
  withFluentSignerChainCheck,
  readFluentSignerChainCheck,
] = loadSessionModule();

/** `sendCalls`, verbatim, as a script whose value is the callback. */
const sendCallsSource = (() => {
  const source = compiled(ts.ModuleKind.ESNext);
  const begin = source.indexOf("const sendCalls = useCallback(");
  const end = source.indexOf("\n    const ", begin + 1);
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  return `${source.slice(begin, end)}\nsendCalls;`;
})();

type RpcCall = { endpoint: "chain" | "bundler"; method: string; params?: unknown };

type ChainScript = {
  /** How many `eth_getLogs` polls come back empty before the operation's event appears. */
  emptyPolls?: number;
  /**
   * Awaited before each `eth_getLogs` answer, so a test can hold one send inside its inclusion
   * wait while it drives another operation.
   */
  onGetLogs?: (poll: number) => void | Promise<void>;
  logsError?: Error;
  blockNumberError?: Error;
  gasPriceError?: Error;
  /** Called as `eth_gasPrice` is answered — the one point inside a send's preparation. */
  onGasPrice?: () => void;
};

type BundlerScript = {
  /** One answer per `eth_sendUserOperation`: a hash, or an error message to reject with. */
  submissions?: Array<Hash | { rejectWith: string }>;
  /** Whether `eth_getUserOperationReceipt` has a receipt to give. */
  receipt?: boolean;
};

function userOperationEventLog(userOpHash: Hash, logIndex = 0) {
  return {
    address: ENTRY_POINT,
    topics: encodeEventTopics({
      abi: [userOperationReceipt.FLUENT_USER_OPERATION_EVENT],
      args: { userOpHash, sender: SMART_ACCOUNT, paymaster: PAYMASTER },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [9n, true, 5_000_000_000_000n, 120_000n],
    ),
    blockNumber: numberToHex(INCLUDED_BLOCK),
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: "0x1",
    logIndex: numberToHex(logIndex),
    removed: false,
  };
}

const INCLUSION_EVENT = userOperationEventLog(USER_OP_HASH);

function transactionReceipt(userOpHash: Hash = USER_OP_HASH) {
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
    logs: [userOperationEventLog(userOpHash)],
    logsBloom: `0x${"0".repeat(512)}`,
    status: "0x1",
    type: "0x2",
    effectiveGasPrice: numberToHex(CHAIN_GAS_PRICE),
  };
}

/** The bundler's own receipt for the same operation, as `eth_getUserOperationReceipt` gives it. */
function bundlerReceipt() {
  return {
    userOpHash: USER_OP_HASH,
    entryPoint: ENTRY_POINT,
    sender: SMART_ACCOUNT,
    nonce: numberToHex(9n),
    success: true,
    paymaster: PAYMASTER,
    actualGasCost: numberToHex(5_000_000_000_000n),
    actualGasUsed: numberToHex(120_000n),
    logs: [INCLUSION_EVENT],
    receipt: transactionReceipt(),
  };
}

/** A JSON-RPC answer as viem reads it off `fetch`. */
function rpcResult(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A JSON-RPC rejection — what a bundler answers a user operation it refuses. */
function rpcError(id: unknown, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** An endpoint that is down, so viem's transport retries it and then gives up. */
function rpcUnavailable() {
  return new Response("endpoint unavailable", { status: 500 });
}

/**
 * One widget, its two endpoints and its Signer.
 *
 * The transports are the widget's own — `core/rpc.ts` builds them, retry policy included — and
 * the fake sits where the network is: `fetch`. The URL decides which endpoint answered, so the
 * recorded calls say what reached the chain and what reached the bundler.
 *
 * `execution` is read through a function, as the widget reads it: a test can change it between
 * sends the way a host changes `FluentWidgetConfig.execution`, with the kernel already cached.
 */
function setup(
  options: {
    execution?: Partial<ResolvedFluentWidgetExecution>;
    chainScript?: ChainScript;
    bundlerScript?: BundlerScript;
    signerMode?: "prompt" | "silent";
    sponsored?: boolean;
  } = {},
) {
  const calls: RpcCall[] = [];
  const chainScript = options.chainScript ?? {};
  const bundlerScript = options.bundlerScript ?? {};
  let execution: ResolvedFluentWidgetExecution = {
    ...config.FLUENT_CONNECT_DEFAULT_EXECUTION,
    ...options.execution,
  };
  const readExecution: ExecutionReader = () => execution;
  let logPoll = 0;
  let submission = 0;
  /** The operation the chain's logs last answered for, so its transaction holds its event. */
  let includedHash: Hash = USER_OP_HASH;
  const answerChain = async (id: unknown, method: string, params?: unknown) => {
    if (method === "eth_chainId") return rpcResult(id, numberToHex(chain.id));
    if (method === "eth_blockNumber") {
      if (chainScript.blockNumberError) return rpcUnavailable();
      return rpcResult(id, numberToHex(ANCHOR_BLOCK));
    }
    if (method === "eth_gasPrice") {
      chainScript.onGasPrice?.();
      if (chainScript.gasPriceError) return rpcUnavailable();
      return rpcResult(id, numberToHex(CHAIN_GAS_PRICE));
    }
    if (method === "eth_getLogs") {
      if (chainScript.logsError) return rpcUnavailable();
      const poll = logPoll;
      logPoll += 1;
      await chainScript.onGetLogs?.(poll);
      // A node answers the filter it was given: the event of the operation whose hash is in
      // `topics[1]`, and nothing else. The widget polls for the hash of its latest submission,
      // so a filter for another operation finds nothing — as on the chain.
      const [filter] = (params ?? []) as [{ topics?: (Hex | null)[] }];
      const requested = filter?.topics?.[1];
      if (poll < (chainScript.emptyPolls ?? 0) || typeof requested !== "string") {
        return rpcResult(id, []);
      }
      includedHash = requested as Hash;
      return rpcResult(id, [userOperationEventLog(includedHash)]);
    }
    if (method === "eth_getTransactionReceipt") {
      return rpcResult(id, transactionReceipt(includedHash));
    }
    if (method === "eth_getBlockByNumber") {
      return rpcResult(id, {
        number: numberToHex(INCLUDED_BLOCK),
        timestamp: numberToHex(1_700_000_000n),
      });
    }
    throw new Error(`unexpected chain method ${method}`);
  };
  const answerBundler = (id: unknown, method: string) => {
    if (method === "eth_chainId") return rpcResult(id, numberToHex(chain.id));
    if (method === "zd_getUserOperationGasPrice") {
      return rpcResult(id, {
        standard: {
          maxFeePerGas: numberToHex(BUNDLER_FEES.maxFeePerGas),
          maxPriorityFeePerGas: numberToHex(BUNDLER_FEES.maxPriorityFeePerGas),
        },
      });
    }
    if (method === "eth_estimateUserOperationGas") {
      return rpcResult(id, {
        callGasLimit: numberToHex(100_000n),
        preVerificationGas: numberToHex(50_000n),
        verificationGasLimit: numberToHex(80_000n),
      });
    }
    if (method === "eth_sendUserOperation") {
      const script = bundlerScript.submissions ?? [USER_OP_HASH];
      const next = script[submission] ?? script.at(-1);
      submission += 1;
      if (next && typeof next === "object") return rpcError(id, next.rejectWith);
      return rpcResult(id, next);
    }
    if (method === "eth_getUserOperationReceipt") {
      return rpcResult(id, bundlerScript.receipt ? bundlerReceipt() : null);
    }
    throw new Error(`unexpected bundler method ${method}`);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = typeof input === "string" ? input : String((input as { url?: string }).url);
      const endpoint = url.startsWith(ZERODEV_RPC_URL) ? "bundler" : "chain";
      const body = JSON.parse(init?.body ?? "{}") as {
        id?: unknown;
        method: string;
        params?: unknown;
      };
      calls.push({ endpoint, method: body.method, params: body.params });
      return endpoint === "bundler"
        ? answerBundler(body.id, body.method)
        : answerChain(body.id, body.method, body.params);
    }),
  );
  const publicClient = viem.createPublicClient({
    chain,
    transport: rpc.createFluentRpcTransport(chain),
  });

  // The Signer: a Privy embedded wallet, its provider and Privy's two prompt hooks.
  const providerRequest = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return numberToHex(chain.id);
    if (method === "personal_sign" || method === "eth_signTypedData_v4") return SIGNATURE;
    throw new Error(`unexpected provider method ${method}`);
  });
  const wallet: PrivyWallet = {
    address: SIGNER,
    getEthereumProvider: async () => ({ request: providerRequest }),
    switchChain: vi.fn(async () => undefined),
  };
  const promptSignMessage = vi.fn(async () => ({ signature: SIGNATURE }));
  const promptSignTypedData = vi.fn(async () => ({ signature: SIGNATURE }));
  const promptedSigners = {
    signMessage: promptSignMessage as unknown as (
      ...args: never[]
    ) => Promise<{ signature: string }>,
    signTypedData: promptSignTypedData as unknown as (
      ...args: never[]
    ) => Promise<{ signature: string }>,
  };
  const signerMode = options.signerMode ?? "silent";
  const signer =
    signerMode === "prompt"
      ? toPromptedPrivyLocalAccount(wallet, promptedSigners)
      : toSilentPrivyLocalAccount(wallet);

  /**
   * The smart account, signing a user operation the way a Kernel account does: it asks its
   * validator's signer for a signature over the operation's hash, so a second submission costs
   * a second signature from the Signer above.
   */
  const derivedAccount = {
    address: SMART_ACCOUNT,
    type: "smart" as const,
    entryPoint: { address: ENTRY_POINT, version: "0.7" as const },
    getFactoryArgs: async () => ({}),
    encodeCalls: async () => "0x1234" as Hex,
    getNonce: async () => 9n,
    getStubSignature: async () => SIGNATURE,
    signUserOperation: async () => signer.signMessage({ message: { raw: USER_OP_HASH } }),
    // A Kernel account answers `widget.signMessage` and `widget.signTypedData` by asking its
    // validator's signer, which is the adapter above: the ERC-1271 wrapping it puts around the
    // result changes no request the Signer makes.
    signMessage: ({ message }: { message: viem.SignableMessage }) =>
      signer.signMessage({ message }),
    signTypedData: (typedData: never) => signer.signTypedData(typedData),
  };
  /** The kernel's account as `createFluentZeroDevKernel` hands it over. */
  const account = toFluentSigningAccount({
    account: derivedAccount,
    wallet,
    chain,
    readExecution,
  });
  const kernelTarget: ClientTarget = {
    account: account as unknown as SmartAccount,
    chain,
    publicClient,
    zeroDevRpcUrl: ZERODEV_RPC_URL,
  };
  const client = createFluentZeroDevKernelClient({ kernel: kernelTarget, readExecution });
  const sponsoredKernelClient = createFluentZeroDevKernelClient({
    kernel: kernelTarget,
    readExecution,
    paymaster: {
      getPaymasterData: async () => ({ paymaster: PAYMASTER, paymasterData: "0x" as Hex }),
    },
  });
  const kernel = {
    account,
    client,
    publicClient,
    smartAccountAddress: SMART_ACCOUNT,
    zeroDevRpcUrl: kernelTarget.zeroDevRpcUrl,
    chain,
    signerMode,
    signerSource: "privy",
  };
  // The timing lines of `core/userOperationTiming.ts` go through the module's own gated
  // writer, so the whole of a send's diagnostics is read off one console.
  debugLogger.setDebugLogging(true);
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const debugLog = vi.fn(debugLogger.debugLog);
  const debugWarn = vi.fn(debugLogger.debugWarn);
  const initialize = vi.fn(async () => kernel);
  const send = runInNewContext(sendCallsSource, {
    performance,
    sendUserOperationWithTiming: userOperationTiming.sendUserOperationWithTiming,
    closeSendTiming: userOperationTiming.closeSendTiming,
    monotonicNow: userOperationTiming.monotonicNow,
    epochNow: userOperationTiming.epochNow,
    span: userOperationTiming.span,
    validateUserOperationGas: userOperationGas.validateUserOperationGas,
    isFluentFeeRejection: userOperationFees.isFluentFeeRejection,
    readFluentInclusionAnchor: userOperationReceipt.readFluentInclusionAnchor,
    waitForFluentUserOperationReceipt: userOperationReceipt.waitForFluentUserOperationReceipt,
    readExecution,
    withFluentSignerChainCheck,
    readFluentSignerChainCheck,
    useCallback: (fn: unknown) => fn,
    authenticated: true,
    ready: true,
    network: "testnet",
    error: null,
    embeddedWallet: wallet,
    hookOptions: options.sponsored
      ? {
          sponsorshipUrl: "https://sponsorship.fluent.test",
          appId: "app_8908941315934a06b738c6804ce26132",
          sponsorshipTokenSource: () => ({
            accountType: "smart",
            getAuthToken: async () => "fluent.token",
          }),
        }
      : {},
    kernels: { [signerMode]: kernel },
    initialize,
    confirmationToSignerMode: (confirmation: string) =>
      confirmation === "session" ? "silent" : "prompt",
    createSponsoredClient: () => () => sponsoredKernelClient,
    resolveSponsorshipBearer: sponsoredClient.resolveSponsorshipBearer,
    sendWithSponsorship: sponsoredClient.sendWithSponsorship,
    sponsorshipLog: { debug: debugLog, warn: debugWarn },
    createFluentZeroDevErc20ExecutionClient,
    createFluentZeroDevErc20PaymasterApprovalCall:
      zerodevPaymaster.createFluentZeroDevErc20PaymasterApprovalCall,
    getFluentGasTokenAddress: gasPayment.getFluentGasTokenAddress,
    sponsorshipUnavailable: { current: false },
    readUserOperationPaymaster,
    zeroAddress,
    debugLog,
    debugWarn,
    debugError() {},
  }) as (
    calls: typeof CALLS,
    options?: { confirmation?: "always" | "session" },
    readyAccount?: unknown,
  ) => Promise<FluentExecuteResult>;

  return {
    calls,
    client,
    consoleLog,
    debugLog,
    initialize,
    kernel,
    providerRequest,
    promptSignMessage,
    promptSignTypedData,
    send: (confirmation: "always" | "session" = signerMode === "prompt" ? "always" : "session") =>
      send(CALLS, { confirmation }, kernel),
    setExecution: (next: Partial<ResolvedFluentWidgetExecution>) => {
      execution = { ...execution, ...next };
    },
    signer,
    wallet,
  };
}

function methodsOf(calls: RpcCall[], endpoint?: "chain" | "bundler") {
  return calls
    .filter((call) => endpoint === undefined || call.endpoint === endpoint)
    .map((call) => call.method);
}

/** The last `label` line a send wrote, as the host's console received it. */
function lineOf(consoleLog: ReturnType<typeof vi.spyOn>, label: string) {
  const line = consoleLog.mock.calls.filter(([written]) => written === label).at(-1);
  return (line?.[1] ?? {}) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  debugLogger.setDebugLogging(false);
});

describe("a send that asks the chain", () => {
  it("reads the anchor block before it hands the operation to the bundler", async () => {
    const widget = setup();

    await widget.send();

    const anchorAt = widget.calls.findIndex((call) => call.method === "eth_blockNumber");
    const broadcastAt = widget.calls.findIndex(
      (call) => call.method === "eth_sendUserOperation",
    );
    expect(anchorAt).toBeGreaterThanOrEqual(0);
    expect(broadcastAt).toBeGreaterThan(anchorAt);
  });

  it("quotes the fees off the chain and asks the bundler for no gas price", async () => {
    const widget = setup();

    await widget.send();

    expect(methodsOf(widget.calls, "chain")).toContain("eth_gasPrice");
    expect(methodsOf(widget.calls, "bundler")).not.toContain("zd_getUserOperationGasPrice");
    const [operation] = (widget.calls.find((call) => call.method === "eth_sendUserOperation")
      ?.params ?? []) as [{ maxFeePerGas: Hex; maxPriorityFeePerGas: Hex }];
    expect(BigInt(operation.maxPriorityFeePerGas)).toBe(CHAIN_GAS_PRICE);
    expect(BigInt(operation.maxFeePerGas)).toBe((CHAIN_GAS_PRICE * 110n) / 100n);
  });

  it("reads inclusion off the chain's logs and asks the bundler for no receipt", async () => {
    const widget = setup();

    const result = await widget.send();

    expect(methodsOf(widget.calls, "chain")).toContain("eth_getLogs");
    expect(methodsOf(widget.calls, "bundler")).not.toContain("eth_getUserOperationReceipt");
    expect(result.userOpHash).toBe(USER_OP_HASH);
    expect(result.hash).toBe(TRANSACTION_HASH);
    expect(result.receipt?.transactionHash).toBe(TRANSACTION_HASH);
  });

  it("names the chain on both of the send's timing lines", async () => {
    const widget = setup();

    await widget.send();

    expect(lineOf(widget.consoleLog, "[fluent submission timing]").feeSource).toBe("chain");
    expect(lineOf(widget.consoleLog, "[fluent inclusion timing]").receiptSource).toBe("chain");
  });

  it("names the bundler on the lines of a send the chain could not quote", async () => {
    const widget = setup({
      chainScript: { gasPriceError: new Error("fluent rpc unreachable") },
    });

    await widget.send();

    expect(lineOf(widget.consoleLog, "[fluent submission timing]").feeSource).toBe("bundler");
  });

  it("keeps the whole batch, the gas policy and the paymaster read of a send", async () => {
    const widget = setup();

    const result = await widget.send();

    expect(result.paymaster).toBe(PAYMASTER);
    expect(result.sponsored).toBe(true);
    expect(result.timing?.instants.attempts).toBe(1);
  });
});

describe("a fee the bundler refuses", () => {
  const twoRejections = {
    submissions: [{ rejectWith: FEE_REJECTION }, { rejectWith: FEE_REJECTION }],
  } satisfies BundlerScript;

  it("prepares, signs and submits a second time with ZeroDev's own quote", async () => {
    const widget = setup({
      bundlerScript: { submissions: [{ rejectWith: FEE_REJECTION }, SECOND_USER_OP_HASH] },
    });

    const result = await widget.send();

    const bundlerMethods = methodsOf(widget.calls, "bundler");
    expect(bundlerMethods.filter((method) => method === "eth_sendUserOperation")).toHaveLength(2);
    // The retry's quote is ZeroDev's, asked for after the first submission was refused.
    expect(bundlerMethods.indexOf("zd_getUserOperationGasPrice")).toBeGreaterThan(
      bundlerMethods.indexOf("eth_sendUserOperation"),
    );
    const submissions = widget.calls.filter(
      (call) => call.method === "eth_sendUserOperation",
    ) as Array<{ params: [{ maxFeePerGas: Hex; maxPriorityFeePerGas: Hex }] }>;
    expect(BigInt(submissions[0]?.params[0].maxFeePerGas ?? 0n)).toBe(
      (CHAIN_GAS_PRICE * 110n) / 100n,
    );
    expect(BigInt(submissions[1]?.params[0].maxFeePerGas ?? 0n)).toBe(BUNDLER_FEES.maxFeePerGas);
    expect(result.userOpHash).toBe(SECOND_USER_OP_HASH);
  });

  it("retries a priority fee the bundler refuses the same way", async () => {
    // alto's other fee sentence, one per fee field; the retry exists for both.
    const widget = setup({
      bundlerScript: {
        submissions: [
          { rejectWith: "maxPriorityFeePerGas must be at least 1000000" },
          SECOND_USER_OP_HASH,
        ],
      },
    });

    const result = await widget.send();

    expect(
      methodsOf(widget.calls, "bundler").filter((method) => method === "eth_sendUserOperation"),
    ).toHaveLength(2);
    expect(result.userOpHash).toBe(SECOND_USER_OP_HASH);
  });

  it("retries the first rejection with the fee source at the bundler too", async () => {
    // The budget is the send's, not the quote's: a bundler that refuses a fee refuses the
    // operation in front of it, and a fresh quote with a fresh preparation is worth the one
    // retry whichever source answered the attempt it refused.
    const widget = setup({
      execution: { feeSource: "bundler" },
      bundlerScript: { submissions: [{ rejectWith: FEE_REJECTION }, SECOND_USER_OP_HASH] },
    });

    const result = await widget.send();

    const bundlerMethods = methodsOf(widget.calls, "bundler");
    expect(bundlerMethods.filter((method) => method === "eth_sendUserOperation")).toHaveLength(2);
    // One quote per attempt, both ZeroDev's, and the chain was never asked for a price.
    expect(
      bundlerMethods.filter((method) => method === "zd_getUserOperationGasPrice"),
    ).toHaveLength(2);
    expect(methodsOf(widget.calls, "chain")).not.toContain("eth_gasPrice");
    expect(result.userOpHash).toBe(SECOND_USER_OP_HASH);
  });

  it("retries the first rejection of a send whose chain quote had fallen back", async () => {
    const widget = setup({
      chainScript: { gasPriceError: new Error("fluent rpc unreachable") },
      bundlerScript: { submissions: [{ rejectWith: FEE_REJECTION }, SECOND_USER_OP_HASH] },
    });

    const result = await widget.send();

    expect(
      methodsOf(widget.calls, "bundler").filter((method) => method === "eth_sendUserOperation"),
    ).toHaveLength(2);
    expect(result.userOpHash).toBe(SECOND_USER_OP_HASH);
  });

  it("stops at two submissions with the fee source at the bundler", async () => {
    const widget = setup({ execution: { feeSource: "bundler" }, bundlerScript: twoRejections });

    await expect(widget.send()).rejects.toThrow(FEE_REJECTION);

    expect(
      methodsOf(widget.calls, "bundler").filter((method) => method === "eth_sendUserOperation"),
    ).toHaveLength(2);
  });

  it("asks the Signer for a second signature in prompt mode", async () => {
    const widget = setup({
      signerMode: "prompt",
      bundlerScript: { submissions: [{ rejectWith: FEE_REJECTION }, SECOND_USER_OP_HASH] },
    });

    await widget.send();

    expect(widget.promptSignMessage).toHaveBeenCalledTimes(2);
  });

  it("gives the caller the bundler's second error, after exactly two submissions", async () => {
    const widget = setup({ bundlerScript: twoRejections });

    await expect(widget.send()).rejects.toThrow(FEE_REJECTION);

    expect(
      methodsOf(widget.calls, "bundler").filter((method) => method === "eth_sendUserOperation"),
    ).toHaveLength(2);
  });

  it("reports two attempts and the span between their starts", async () => {
    const widget = setup({
      bundlerScript: { submissions: [{ rejectWith: FEE_REJECTION }, SECOND_USER_OP_HASH] },
    });

    const result = await widget.send();

    expect(result.timing?.instants.attempts).toBe(2);
    const retryMs = result.timing?.retryMs ?? -1;
    expect(retryMs).toBeGreaterThan(0);
    // The overhead is the first attempt's span, and it is inside no stage of the settled one.
    expect(retryMs).toBeLessThan(result.timing?.totalMs ?? 0);
  });

  it("asks the chain's gas price first again on the next send", async () => {
    const widget = setup({
      bundlerScript: { submissions: [{ rejectWith: FEE_REJECTION }, SECOND_USER_OP_HASH] },
    });
    await widget.send();
    widget.calls.length = 0;

    await widget.send();

    const chainMethods = methodsOf(widget.calls, "chain");
    expect(chainMethods).toContain("eth_gasPrice");
    expect(methodsOf(widget.calls, "bundler")).not.toContain("zd_getUserOperationGasPrice");
  });

  it("does not retry a failure that is not about the fees", async () => {
    const widget = setup({
      bundlerScript: {
        submissions: [{ rejectWith: "AA23 reverted: account validation failed" }],
      },
    });

    await expect(widget.send()).rejects.toThrow("AA23 reverted");

    expect(
      methodsOf(widget.calls, "bundler").filter((method) => method === "eth_sendUserOperation"),
    ).toHaveLength(1);
  });

  it("answers a sponsored send's fee rejection without an own-gas submission", async () => {
    // Sponsorship reads a failed submission as the paymaster's refusal and resends with own
    // gas. A fee the bundler refused is neither, and a third operation would be exactly the
    // retry the criteria forbid.
    const widget = setup({ sponsored: true, bundlerScript: twoRejections });

    await expect(widget.send()).rejects.toThrow(FEE_REJECTION);

    expect(
      methodsOf(widget.calls, "bundler").filter((method) => method === "eth_sendUserOperation"),
    ).toHaveLength(2);
  });

  it("leaves an ordinary sponsored send sponsored", async () => {
    // The narrow predicate must not have taken sponsorship's own path with it. What a rejected
    // bearer does — one forced token refresh and one more sponsored submission — is asserted
    // against the sponsorship module itself in `core/sponsoredClient.test.ts`; this is the
    // widget's own sponsored send, which still settles through the paymaster.
    const widget = setup({ sponsored: true });

    const result = await widget.send();

    expect(result.sponsored).toBe(true);
    expect(result.userOpHash).toBe(USER_OP_HASH);
  });
});

describe("inclusion the chain cannot answer", () => {
  it("broadcasts and waits on the bundler when the anchor block cannot be read", async () => {
    const widget = setup({
      chainScript: { blockNumberError: new Error("fluent rpc unreachable") },
      bundlerScript: { receipt: true },
    });

    const result = await widget.send();

    expect(methodsOf(widget.calls, "bundler")).toContain("eth_sendUserOperation");
    expect(methodsOf(widget.calls, "chain")).not.toContain("eth_getLogs");
    expect(methodsOf(widget.calls, "bundler")).toContain("eth_getUserOperationReceipt");
    expect(result.userOpHash).toBe(USER_OP_HASH);
    expect(lineOf(widget.consoleLog, "[fluent inclusion timing]").receiptSource).toBe("bundler");
  });

  it("hands the caller the receipt the bundler's continuation found", async () => {
    const widget = setup({
      chainScript: { logsError: new Error("fluent rpc unreachable") },
      bundlerScript: { receipt: true },
    });

    const result = await widget.send();

    expect(result.userOpHash).toBe(USER_OP_HASH);
    expect(result.hash).toBe(TRANSACTION_HASH);
    expect(methodsOf(widget.calls, "bundler")).toContain("eth_getUserOperationReceipt");
  });

  it("returns the same result field by field, from the chain and from the bundler", async () => {
    const fromChain = await setup().send();
    const fromBundler = await setup({
      execution: { receiptSource: "bundler" },
      bundlerScript: { receipt: true },
    }).send();

    expect(fromChain.hash).toEqual(fromBundler.hash);
    expect(fromChain.userOpHash).toEqual(fromBundler.userOpHash);
    expect(fromChain.sponsored).toEqual(fromBundler.sponsored);
    expect(fromChain.paymaster).toEqual(fromBundler.paymaster);
    expect(fromChain.receipt).toEqual(fromBundler.receipt);
  });

  it("polls the bundler, as before, with the receipt source at bundler", async () => {
    const widget = setup({
      execution: { receiptSource: "bundler" },
      bundlerScript: { receipt: true },
    });

    await widget.send();

    expect(methodsOf(widget.calls, "chain")).not.toContain("eth_blockNumber");
    expect(methodsOf(widget.calls, "chain")).not.toContain("eth_getLogs");
    expect(methodsOf(widget.calls, "bundler")).toContain("eth_getUserOperationReceipt");
    expect(lineOf(widget.consoleLog, "[fluent inclusion timing]").receiptSource).toBe("bundler");
  });
});

describe("settings a later send reads", () => {
  it("obeys a host that switched both sources back, with the kernel already cached", async () => {
    const widget = setup({ bundlerScript: { receipt: true } });
    await widget.send();
    expect(widget.initialize).not.toHaveBeenCalled();
    widget.calls.length = 0;

    widget.setExecution({ feeSource: "bundler", receiptSource: "bundler" });
    await widget.send();

    expect(methodsOf(widget.calls, "bundler")).toContain("zd_getUserOperationGasPrice");
    expect(methodsOf(widget.calls, "bundler")).toContain("eth_getUserOperationReceipt");
    expect(methodsOf(widget.calls, "chain")).not.toContain("eth_gasPrice");
    expect(methodsOf(widget.calls, "chain")).not.toContain("eth_getLogs");
    // The same kernel, so this is the cached client obeying the new settings.
    expect(widget.initialize).not.toHaveBeenCalled();
  });

  it("obeys a host that switched them on again", async () => {
    const widget = setup({
      execution: { feeSource: "bundler", receiptSource: "bundler" },
      bundlerScript: { receipt: true },
    });
    await widget.send();
    widget.calls.length = 0;

    widget.setExecution({ feeSource: "chain", receiptSource: "chain" });
    await widget.send();

    expect(methodsOf(widget.calls, "chain")).toContain("eth_gasPrice");
    expect(methodsOf(widget.calls, "chain")).toContain("eth_getLogs");
    expect(methodsOf(widget.calls, "bundler")).not.toContain("zd_getUserOperationGasPrice");
  });
});

describe("the Signer's chain before a signature", () => {
  // The widget asks for a standalone signature through the kernel's account, which is where
  // `execution.chainCheckBeforeSign` is answered: `widget.signMessage` and
  // `widget.signTypedData` call `kernel.account.signMessage` and `kernel.account.signTypedData`
  // (`hooks/useWidgetExecution.ts`).
  it("sends the provider nothing but personal_sign in silent mode", async () => {
    const widget = setup({ signerMode: "silent" });

    await widget.kernel.account.signMessage({ message: "hello" });

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "personal_sign",
    ]);
    expect(widget.wallet.switchChain).not.toHaveBeenCalled();
  });

  it("sends the provider nothing but eth_signTypedData_v4 in silent mode", async () => {
    const widget = setup({ signerMode: "silent" });

    await widget.kernel.account.signTypedData(TYPED_DATA);

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_signTypedData_v4",
    ]);
  });

  it("makes one call, Privy's signMessage, in prompt mode", async () => {
    const widget = setup({ signerMode: "prompt" });

    await widget.kernel.account.signMessage({ message: "hello" });

    expect(widget.promptSignMessage).toHaveBeenCalledTimes(1);
    expect(widget.providerRequest).not.toHaveBeenCalled();
  });

  it("makes one call, Privy's signTypedData, in prompt mode", async () => {
    const widget = setup({ signerMode: "prompt" });

    await widget.kernel.account.signTypedData(TYPED_DATA);

    expect(widget.promptSignTypedData).toHaveBeenCalledTimes(1);
    expect(widget.providerRequest).not.toHaveBeenCalled();
  });

  it("asks Privy for a message signature without its screen in prompt mode", async () => {
    const widget = setup({ signerMode: "prompt" });

    await widget.kernel.account.signMessage({ message: "hello" });

    expect(widget.promptSignMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uiOptions: { showWalletUIs: false } }),
    );
  });

  it("asks Privy for a typed-data signature without its screen in prompt mode", async () => {
    const widget = setup({ signerMode: "prompt" });

    await widget.kernel.account.signTypedData(TYPED_DATA);

    expect(widget.promptSignTypedData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uiOptions: { showWalletUIs: false } }),
    );
  });

  it("reads the chain before a silent signature when the host asks for it", async () => {
    const widget = setup({
      signerMode: "silent",
      execution: { chainCheckBeforeSign: true },
    });

    await widget.kernel.account.signMessage({ message: "hello" });
    await widget.kernel.account.signTypedData(TYPED_DATA);

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_chainId",
      "personal_sign",
      "eth_chainId",
      "eth_signTypedData_v4",
    ]);
  });

  it("reads the chain before a prompted signature when the host asks for it", async () => {
    const widget = setup({
      signerMode: "prompt",
      execution: { chainCheckBeforeSign: true },
    });

    await widget.kernel.account.signMessage({ message: "hello" });

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_chainId",
    ]);
    expect(widget.promptSignMessage).toHaveBeenCalledTimes(1);
  });

  it("reads the chain before prompted typed data when the host asks for it", async () => {
    const widget = setup({
      signerMode: "prompt",
      execution: { chainCheckBeforeSign: true },
    });

    await widget.kernel.account.signTypedData(TYPED_DATA);

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_chainId",
    ]);
    expect(widget.promptSignTypedData).toHaveBeenCalledTimes(1);
  });

  it("obeys a host that turned the check back on between signatures", async () => {
    const widget = setup({ signerMode: "silent" });

    await widget.kernel.account.signMessage({ message: "first" });
    widget.setExecution({ chainCheckBeforeSign: true });
    await widget.kernel.account.signMessage({ message: "second" });

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "personal_sign",
      "eth_chainId",
      "personal_sign",
    ]);
  });

  it("keeps the setting a send started with when the host changes it mid-send", async () => {
    let changedDuringSend = false;
    const widget = setup({
      execution: { chainCheckBeforeSign: true },
      chainScript: {
        onGasPrice: () => {
          // `eth_gasPrice` is answered inside the operation's preparation, before the Signer is
          // asked for anything: a send that read `true` must still check its chain here.
          if (changedDuringSend) return;
          changedDuringSend = true;
          widget.setExecution({ chainCheckBeforeSign: false });
        },
      },
    });

    await widget.send();

    expect(changedDuringSend).toBe(true);
    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_chainId",
      "personal_sign",
    ]);
    // And the send took its setting with it: the next signature obeys the host's new one.
    await widget.kernel.account.signMessage({ message: "after" });
    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_chainId",
      "personal_sign",
      "personal_sign",
    ]);
  });

  it("checks the chain for a send the host turned the check on for", async () => {
    // The mirror of the case above: a send that read `false` is not made to check by a change
    // that lands while it runs, and the send after it is.
    let changedDuringSend = false;
    const widget = setup({
      chainScript: {
        onGasPrice: () => {
          if (changedDuringSend) return;
          changedDuringSend = true;
          widget.setExecution({ chainCheckBeforeSign: true });
        },
      },
    });

    await widget.send();

    expect(changedDuringSend).toBe(true);
    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "personal_sign",
    ]);

    await widget.send();

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "personal_sign",
      "eth_chainId",
      "personal_sign",
    ]);
  });

  it.each([true, false])(
    "checks the Signer's chain once when the kernel is created (chainCheckBeforeSign %s)",
    async (chainCheckBeforeSign) => {
      // The kernel's own check stays whatever the setting says: this is the one moment the
      // Signer's chain has not been established, and the smart account is derived from it.
      // Account derivation needs a chain nothing answers here, so the creation fails after
      // the check — which is the call under test.
      const widget = setup({ execution: { chainCheckBeforeSign } });

      await expect(
        createFluentZeroDevKernel({
          wallet: widget.wallet,
          signerMode: "silent",
          promptedSigners: {
            signMessage: widget.promptSignMessage as never,
            signTypedData: widget.promptSignTypedData as never,
          },
          chain,
          readExecution: () => ({
            ...config.FLUENT_CONNECT_DEFAULT_EXECUTION,
            chainCheckBeforeSign,
          }),
        }),
      ).rejects.toThrow();

      expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
        "eth_chainId",
      ]);
    },
  );
});

describe("one operation's setting reaching no other", () => {
  /**
   * Each of these drives a second operation while the first is held inside its inclusion wait,
   * which is where a send spends most of its life: the first send is past its signature, and a
   * setting it is still holding would be a setting nothing can get rid of.
   */
  function heldSend(execution: Partial<ResolvedFluentWidgetExecution>) {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: (() => void) | undefined;
    const reached = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const widget = setup({
      execution,
      chainScript: {
        onGetLogs: async (poll) => {
          // The first poll of the first send only: every later wait runs unheld.
          if (poll > 0) return;
          holding?.();
          await held;
        },
      },
    });
    return { widget, reached, release };
  }

  it("reads the live setting for a standalone signature while an older send waits", async () => {
    // The older send pinned `false`; the host has since asked for the check. The signature is
    // nobody's but its own, so it obeys the host.
    const { widget, reached, release } = heldSend({ chainCheckBeforeSign: false });
    const sending = widget.send();
    await reached;
    widget.setExecution({ chainCheckBeforeSign: true });

    await widget.kernel.account.signMessage({ message: "independent signature" });

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      // The held send's own signature, then the standalone one with its check.
      "personal_sign",
      "eth_chainId",
      "personal_sign",
    ]);
    release();
    await sending;
  });

  it("keeps a later send free of the check while an older send that checks waits", async () => {
    // The older send pinned `true`; the host has since turned the check off. The later send
    // read `false` at its start and signs without a round trip, whatever the older one holds.
    const { widget, reached, release } = heldSend({ chainCheckBeforeSign: true });
    const sending = widget.send();
    await reached;
    widget.setExecution({ chainCheckBeforeSign: false });

    await widget.send();

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      // The held send's check and signature, then the later send's signature alone.
      "eth_chainId",
      "personal_sign",
      "personal_sign",
    ]);
    release();
    await sending;
  });

  it("keeps the check for a later send while an older send that does not check waits", async () => {
    const { widget, reached, release } = heldSend({ chainCheckBeforeSign: false });
    const sending = widget.send();
    await reached;
    widget.setExecution({ chainCheckBeforeSign: true });

    await widget.send();

    expect(widget.providerRequest.mock.calls.map(([args]) => args.method)).toEqual([
      "personal_sign",
      "eth_chainId",
      "personal_sign",
    ]);
    release();
    await sending;
  });
});

describe("the account one operation signs with", () => {
  // The two above cover the criteria through the operations that have them; these two are about
  // the channel they travel on, which is what keeps one operation's setting out of another's.
  it("carries the Signer's chain check, so a send can run it under its own setting", () => {
    const widget = setup();

    expect(readFluentSignerChainCheck(widget.kernel.account)).toBeTypeOf("function");
    // Nothing else is: an account that never passed through the kernel has no Signer behind it.
    expect(readFluentSignerChainCheck({})).toBeUndefined();
    expect(readFluentSignerChainCheck(undefined)).toBeUndefined();
  });

  it("runs the step before the named signature and before no other", async () => {
    const steps: string[] = [];
    const signed: string[] = [];
    const account = {
      signUserOperation: async () => {
        signed.push("signUserOperation");
        return SIGNATURE;
      },
      signMessage: async () => {
        signed.push("signMessage");
        return SIGNATURE;
      },
    };

    const checked = withFluentSignerChainCheck(account, ["signUserOperation"], async () => {
      steps.push("before");
    });
    await checked.signUserOperation();
    await checked.signMessage();

    expect(steps).toEqual(["before"]);
    expect(signed).toEqual(["signUserOperation", "signMessage"]);
  });
});

describe("every kernel client the widget builds", () => {
  it("is built through the one constructor that installs the fee hook", () => {
    // Four clients can reach a submission — the Privy-signed kernel, the session kernel, the
    // sponsored client and the ERC-20 gas client — and a client built without the hook inherits
    // ZeroDev's `zd_getUserOperationGasPrice` default. The behaviour of each of the four is
    // under test above; what this asserts is that there is no fifth way to build one: the file
    // calls `createKernelAccountClient` exactly once, inside that constructor.
    const source = readFileSync(new URL("./zerodevSession.ts", import.meta.url), "utf8");
    expect(source.match(/createKernelAccountClient\(/g)).toHaveLength(1);
    // Its definition and its four call sites.
    expect(source.match(/createFluentZeroDevKernelClient\(/g)).toHaveLength(5);
  });
});

describe("the ERC-20 gas client", () => {
  it("carries the fee hook, so a token-paid send quotes the chain too", async () => {
    const widget = setup();
    const gasToken = gasPayment.getFluentGasTokenAddress("BLEND", "testnet");
    expect(gasToken).toBeDefined();
    const erc20Client = createFluentZeroDevErc20ExecutionClient(
      {
        account: widget.kernel.account as unknown as SmartAccount,
        chain,
        publicClient: widget.kernel.publicClient,
        zeroDevRpcUrl: widget.kernel.zeroDevRpcUrl,
      },
      gasToken as Address,
      () => config.FLUENT_CONNECT_DEFAULT_EXECUTION,
    );

    expect(erc20Client.userOperation?.estimateFeesPerGas).toBeTypeOf("function");
  });

  it("is built with ZeroDev's own default on neither client", async () => {
    const widget = setup();

    expect(widget.client.userOperation?.estimateFeesPerGas).toBeTypeOf("function");
    // ZeroDev installs its `zd_getUserOperationGasPrice` default only when the client carries
    // no hook of its own (`@zerodev/sdk/_esm/clients/kernelAccountClient.js:38-43`).
    await widget.send();
    expect(methodsOf(widget.calls, "bundler")).not.toContain("zd_getUserOperationGasPrice");
  });
});
