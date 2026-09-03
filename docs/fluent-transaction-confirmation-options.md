# Fluent Transaction Confirmation Options

Fluent Connect can support more than one signing UX, but builders should choose
the mode deliberately. The key distinction is whether the user confirms every
transaction, whether an authenticated embedded-wallet session may sign without a
fresh prompt, or whether the user has created a bounded delegated permission.

## Recommended Default: Confirm Every Operation

Builder apps should default to explicit confirmation for every user-initiated
transaction.

For the ERC-4626 vault example, `approve + deposit` is encoded as one ZeroDev
UserOperation:

```ts
await widget
  .createBatchOp({
    id: "stblend-approve-deposit",
    button: { label: "Approve + deposit" },
    calls: [
      {
        id: "approve-asset",
        label: "Approve BLEND",
        to: assetAddress,
        abi: erc20Abi,
        method: "approve",
        args: [vaultAddress, assets],
      },
      {
        id: "deposit-vault",
        label: "Deposit into vault",
        to: vaultAddress,
        abi: vaultAbi,
        method: "deposit",
        args: [assets, userSmartAccount],
      },
    ],
  })
  .execute();
```

Before the SDK calls the embedded signer, it opens a Fluent transaction review:

```ts
await activeExecutor.confirm?.({
  id: input.id,
  button,
  calls: input.calls,
  encodedCalls,
  account: activeExecutor.account,
});

return activeExecutor.sendCalls(encodedCalls);
```

This keeps the UX predictable: even if Privy can silently sign because the
embedded wallet session is authenticated, the Fluent SDK still requires an
explicit user click before signing.

## Session-Style Signing

Session-style signing means the embedded wallet signs during an authenticated
session without a fresh wallet popup for each operation.

This can be useful for high-frequency actions, but it should not be the default
for arbitrary builder apps. It is only appropriate after the user has explicitly
opted into a session-level rule such as:

```ts
await widget.createBatchOp(...).execute({
  confirmation: "session",
});
```

The widget also exposes a non-persistent **Silent signing** toggle in the
connected wallet menu, shown as **Quick sign**. It is **on by default**: for
`createBatchOp()` calls that do not pass an explicit option the widget uses
`confirmation: "session"` rather than `confirmation: "always"`. Turning it off
applies to the current page session only — disconnecting or reloading returns it
to on.

Builders can still force a review for a sensitive operation:

```ts
await widget.createBatchOp(...).execute({
  confirmation: "always",
});
```

The vault builder example explicitly requests session confirmation for deposit
and withdrawal so its cross-origin hosted signer reuses the Fluent Connect
authorization. Other builder operations keep the SDK's explicit-confirmation
default unless they make the same deliberate choice.

## Delegated Permission Sessions

Delegated sessions are the safe automation path. The user signs once to create a
bounded ZeroDev permission, then a session signer can execute only the allowed
calls.

For the vault example:

```ts
const permission = await widget.createPermissionSession({
  label: "Manage stBlend vault position",
  delegate: thirdPartyAddress,
  expiresAt: Date.now() + 60 * 60 * 1000,
  policies: [
    widget.policies.batch({
      id: "approve-deposit",
      calls: [
        {
          to: assetAddress,
          abi: erc20Abi,
          method: "approve",
          args: {
            spender: { equals: vaultAddress },
            amount: { max: maxDepositAmount },
          },
        },
        {
          to: vaultAddress,
          abi: vaultAbi,
          method: "deposit",
          args: {
            assets: { max: maxDepositAmount },
            receiver: { equals: userSmartAccount },
          },
        },
      ],
    }),
    widget.policies.call({
      id: "withdraw-to-third-party",
      to: vaultAddress,
      abi: vaultAbi,
      method: "withdraw",
      args: {
        assets: { max: maxWithdrawAmount },
        receiver: { equals: thirdPartyAddress },
        owner: { equals: userSmartAccount },
      },
    }),
  ],
});
```

The policy locks the vault contract, method selectors, spender, receiver, owner,
maximum amount, and expiry. The delegate cannot use that session to call
arbitrary contracts or move funds outside the policy.

## Builder Decision Table

| Mode | Best for | User prompt frequency | Vault example status |
| --- | --- | --- | --- |
| Confirm every operation | Normal deposits and withdrawals | Every operation | Enabled by default |
| Session-style signing | Repeated user-approved actions | Once per page session after user opt-in | Available through the widget toggle or `execute({ confirmation: "session" })` |
| Delegated permission session | Automation and third-party execution | Once per scoped permission | Available in the deposit modal |

The default rule is simple: if the user did not explicitly grant a bounded
session, show a review before signing.
