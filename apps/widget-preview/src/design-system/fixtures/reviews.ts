import type { FluentBatchOperationReview, FluentWidgetAccount } from "@fluent.xyz/connect";
import type { FluentSignatureReview } from "@fluent.xyz/connect/internal/widget/signRequest";

const SMART_ADDRESS = "0x92b70EDC8975E9Cac4dB54C75c136465817Bb8C7" as const;
const SIGNER_ADDRESS = "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4" as const;
const VAULT = "0x1ccF23916C572379630b067e9a0CbBddb56C5e72" as const;
const USDNR = "0x9CAcf613fC29015893728563f423fD26dCdB8Ddc" as const;

export const smartAccount: FluentWidgetAccount = {
  address: SMART_ADDRESS,
  signerAddress: SIGNER_ADDRESS,
  connected: true,
  executionReady: true,
  executionStatus: "ready",
  type: "smart",
  capabilities: { atomicBatch: true, erc20Gas: true },
};

export const eoaAccount: FluentWidgetAccount = {
  address: SIGNER_ADDRESS,
  connected: true,
  executionReady: true,
  executionStatus: "ready",
  type: "eoa",
  capabilities: { atomicBatch: false, erc20Gas: false },
};

/** An approve-then-deposit batch, as a vault App would ask for. */
export const batchReview: FluentBatchOperationReview = {
  reviewTitle: "Deposit 250 USDnr",
  account: smartAccount,
  calls: [
    { to: USDNR, functionName: "approve", args: [VAULT, 250_000_000n] },
    { to: VAULT, functionName: "deposit", args: [250_000_000n, SMART_ADDRESS] },
    { to: VAULT, label: "Stake rewards", value: 10_000_000_000_000_000n },
  ],
  encodedCalls: [
    { to: USDNR, label: "Approve USDnr", value: 0n, data: "0x095ea7b3" },
    { to: VAULT, label: "Deposit to vault", value: 0n, data: "0x6e553f65" },
    { to: VAULT, label: "Stake rewards", value: 10_000_000_000_000_000n, data: "0x" },
  ],
};

/** Without a title: the dialog falls back to its own. */
export const untitledBatchReview: FluentBatchOperationReview = {
  account: eoaAccount,
  calls: [{ to: VAULT, method: "claim" }],
  encodedCalls: [{ to: VAULT, value: 0n, data: "0x4e71d92d" }],
};

export const messageReview: FluentSignatureReview = {
  kind: "message",
  origin: "https://chess.fluent.xyz",
  account: smartAccount,
  address: SMART_ADDRESS,
  message:
    "chess.fluent.xyz wants you to sign in with your Ethereum account:\n0x92b70EDC8975E9Cac4dB54C75c136465817Bb8C7\n\nSign in to Fluent Chess\n\nURI: https://chess.fluent.xyz\nVersion: 1\nChain ID: 20994\nNonce: 7f3a9c2e\nIssued At: 2026-10-12T09:00:00Z",
};

export const typedDataReview: FluentSignatureReview = {
  kind: "typedData",
  origin: "https://vault.fluent.xyz",
  account: eoaAccount,
  address: SIGNER_ADDRESS,
  typedData: {
    domain: {
      name: "USDnr",
      version: "1",
      chainId: 20994,
      verifyingContract: USDNR,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner: SIGNER_ADDRESS,
      spender: VAULT,
      value: 250_000_000n,
      nonce: 3n,
      deadline: 1_791_800_000n,
    },
  },
};
