# Fluent ZeroDev Signer Architecture

This note describes how Fluent Connect signs batched smart-account transactions
such as ERC-20 `approve` plus ERC-4626 `deposit`.

The short version:

- Privy owns the embedded wallet and produces signatures.
- Fluent wraps that Privy wallet as one of two viem-compatible signer adapters.
- ZeroDev turns that signer into an ECDSA validator.
- The validator becomes the sudo authority for a ZeroDev Kernel smart account.
- `widget.createBatchOp(...).execute()` sends calls through that Kernel account.
- Fluent shows its own transaction review before invoking the signer for normal
  builder operations.

For the builder-facing signing mode decision table, see
`docs/fluent-transaction-confirmation-options.md`.

## Account Model

There are two addresses involved:

1. The Privy embedded wallet address.
   This is the signer. It owns the key material and produces signatures.

2. The ZeroDev Kernel smart account address.
   This is the user-facing Fluent account that holds assets, vault shares, and
   allowances.

Builders should display and use the Kernel smart account address. The Privy
embedded wallet is an implementation detail used for authorization.

## Signer Adapters

The signer starts as a Privy embedded wallet:

```ts
const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
```

Fluent then wraps that wallet into one of two viem-compatible local accounts:

```ts
const signer =
  signerMode === "prompt"
    ? toPromptedPrivyLocalAccount(wallet, promptedSigners)
    : toSilentPrivyLocalAccount(wallet);
```

Both adapters expose the same ZeroDev-facing interface and neither adapter
exposes a private key. The difference is how the signature request is routed.

### Prompt Adapter

`toPromptedPrivyLocalAccount` routes signatures through Privy's React signing
hooks. This is the default path for builder operations:

```ts
await widget.createBatchOp(...).execute({
  confirmation: "always", // default
});
```

The widget first opens Fluent's transaction review modal. After the user
confirms, the prompt adapter calls Privy's `signMessage` or `signTypedData`
hook with user-facing copy:

```ts
function toPromptedPrivyLocalAccount(wallet, promptedSigners) {
  const source = {
    address: wallet.address as Address,

    async signMessage({ message }) {
      const formattedMessage = formatSignableMessageForPrivy(message);

      const { signature } = await promptedSigners.signMessage({
        message: formattedMessage,
      }, {
        address: wallet.address,
        uiOptions: {
          title: "Confirm Fluent transaction",
          description: "Sign the ZeroDev UserOperation for this Fluent account.",
          buttonText: "Sign",
        },
      });

      return signature as Hex;
    },

    async signTypedData(typedData) {
      const { signature } = await promptedSigners.signTypedData(...);

      return signature as Hex;
    },
  };

  return toAccount(source);
}
```

This path is for "ask every time" UX. The user should see a Fluent review before
the embedded signer signs the ZeroDev UserOperation.

### Silent Adapter

`toSilentPrivyLocalAccount` routes signatures directly through the embedded
wallet provider:

```ts
await widget.createBatchOp(...).execute({
  confirmation: "session",
});
```

The adapter calls `personal_sign` or `eth_signTypedData_v4` on the Privy
provider:

```ts
function toSilentPrivyLocalAccount(wallet) {
  const source = {
    address: wallet.address as Address,

    async signMessage({ message }) {
      const provider = await wallet.getEthereumProvider();
      const formattedMessage = formatSignableMessageForPrivy(message);

      const signature = await provider.request({
        method: "personal_sign",
        params: [
          isHex(formattedMessage) ? formattedMessage : stringToHex(formattedMessage),
          wallet.address,
        ],
      });

      return signature as Hex;
    },

    async signTypedData(typedData) {
      const provider = await wallet.getEthereumProvider();

      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [wallet.address, stringifyTypedDataForProvider(typedData)],
      });

      return signature as Hex;
    },
  };

  return toAccount(source);
}
```

This path is only appropriate after explicit session-style consent. The vault
demo exposes it as a non-persistent widget toggle so builders can see the
tradeoff clearly.

In both modes, the signing authority remains the user's Privy wallet. Fluent
only adapts it to the signer interface expected by ZeroDev and viem.

## Validator

The validator is the ZeroDev Kernel plugin that verifies whether a UserOperation
is authorized.

Fluent creates an ECDSA validator from the selected Privy-backed signer:

```ts
const signer =
  signerMode === "prompt"
    ? toPromptedPrivyLocalAccount(wallet, promptedSigners)
    : toSilentPrivyLocalAccount(wallet);

const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
  signer,
  entryPoint,
  kernelVersion: KERNEL_V3_3,
});
```

Then Fluent installs that validator as the Kernel account's sudo plugin:

```ts
const account = await createKernelAccount(publicClient, {
  entryPoint,
  plugins: { sudo: ecdsaValidator },
  kernelVersion: KERNEL_V3_3,
});
```

This means the Kernel account accepts UserOperations only when the Privy wallet
signer authorizes them.

## Batch Execution

A builder app creates a batch through the widget API:

```ts
const hash = await widget
  .createBatchOp({
    id: "stblend-approve-deposit",
    calls: [
      {
        id: "approve-asset",
        to: assetAddress,
        abi: erc20Abi,
        method: "approve",
        args: [vaultAddress, amount],
      },
      {
        id: "deposit-vault",
        to: vaultAddress,
        abi: vaultAbi,
        method: "deposit",
        args: [amount, widget.account.address],
      },
    ],
  })
  .execute();
```

The SDK encodes each ABI call and passes the encoded calls into the active
ZeroDev Kernel client:

```ts
const userOpHash = await activeKernel.client.sendUserOperation({
  account: activeKernel.account,
  calls: calls.map((call) => ({
    to: call.to,
    data: call.data ?? "0x",
    value: call.value ?? 0n,
  })),
});
```

During `sendUserOperation`, ZeroDev asks the Kernel account's validator for a
signature. The validator uses whichever Privy-backed adapter was selected for
that execution mode.

Before `sendUserOperation`, the Fluent widget now opens a Fluent-owned review
modal:

```ts
await activeExecutor.confirm?.({
  id: input.id,
  button,
  calls: input.calls,
  encodedCalls,
  account: activeExecutor.account,
});
```

This review step is intentionally separate from Privy's embedded-wallet UI.
With `confirmation: "always"`, the review is mandatory before the prompt adapter
is invoked. Builders can bypass the Fluent review only through an explicit
session-mode choice:

```ts
await widget.createBatchOp(...).execute({ confirmation: "session" });
```

The widget also has a non-persistent Silent signing toggle (shown as Quick sign)
that uses the same session confirmation mode as its default while the page
session remains active. It is on by default, and turning it off lasts only for
the current page session.

## Execution Readiness

`createBatchOp(...).execute()` is responsible for preparing the signer before
sending calls.

If the Kernel account is already ready, execution continues immediately. If the
Privy signer is not ready, Fluent opens the wallet login/signing flow:

```ts
const ensureExecutionReady = async () => {
  if (kernel && smartAccountReady) return kernel;
  if (!ready) throw new Error("Privy wallet context is still loading");

  if (!authenticated) {
    login();
    throw new Error("Complete wallet login, then submit the transaction again");
  }

  const activeKernel = await initialize({ throwOnError: true });
  if (!activeKernel) throw new Error("ZeroDev smart account is not ready");
  return activeKernel;
};
```

The important rule is that the app should not disable a transaction merely
because the signer is not preloaded. The click path should prepare the signer,
ask the user to sign, then submit.

## Flow Diagram

```text
User clicks approve + deposit
        |
        v
widget.createBatchOp(...).execute()
        |
        v
SDK encodes approve + deposit calls
        |
        v
SDK ensures Privy signer and ZeroDev Kernel are ready
        |
        v
Fluent transaction review asks user to confirm
        |
        v
ZeroDev builds a UserOperation for the Kernel account
        |
        v
ECDSA validator asks Privy-backed signer for a signature
        |
        v
Privy wallet prompts user and signs
        |
        v
ZeroDev submits UserOperation
        |
        v
Bundler returns UserOp receipt and transaction hash
```

## Security Notes

- The SDK never receives or stores the Privy private key.
- The builder app should use the Kernel smart account as the account address.
- The embedded signer address should be treated as internal implementation
  detail.
- Batch calls should be shown clearly in the UI before execution.
- Delegated session keys must be constrained with target, selector, argument,
  value, and expiry policies.
