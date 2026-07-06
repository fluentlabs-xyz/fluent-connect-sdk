# stBlend ERC4626 Vault Builder Example

This app demonstrates a production-oriented builder integration for a Fluent ERC-4626 vault.

It follows `docs/builder-integration-quickstart.md`:

- Uses Fluent Connect authorization through `@fluent/react`.
- Treats the Fluent embedded wallet and Privy integration as Fluent-owned implementation details.
- Reads vault and account state through a Fluent SDK public client using the session smart account address.
- Keeps builder-owned app metadata and vault addresses in `config.json`.
- Keeps ERC-20/ERC-4626 ABIs, vault reads, previews, and calldata builders in `src/contracts/vault.ts`.
- Keeps the Fluent SDK public client in `src/consts.ts`.
- Submits `approve + deposit` through `widget.createBatchOp()` and withdraw through the user's ZeroDev Fluent smart account.
- Grants a scoped ZeroDev permission session through `widget.createPermissionSession()` for delegated approve/deposit/withdraw demos.

## Configuration

Vault-specific settings are checked into `config.json` so builders can see exactly what they need to change:

```json
{
  "fluent": {
    "appName": "stBlend ERC4626 Vault",
    "source": "erc4626_vault_builder_example",
    "campaign": "stblend_vault"
  },
  "vault": {
    "address": "0xcd78874E6625557C3C50891969ac1040DE26E097",
    "implementationAddress": "0x009b52e26546bC8738B5fDE50F8650DA837B04cc",
    "assetAddress": null
  }
}
```

The app reads the underlying token from `asset()` on the vault. Set `vault.assetAddress` only if a builder needs an explicit override.

## Environment Overrides

```bash
VITE_FLUENT_AUTHORIZE_URL=https://connect.fluent.xyz/authorize
VITE_FLUENT_RPC_URL=<fluent-testnet-rpc-url>
```

For this demo environment, run the app with the Fluent Connect staging authorize URL:

```bash
VITE_FLUENT_AUTHORIZE_URL=https://fluent-connect.46.101.102.12.sslip.io/authorize
```

The default vault target is the stBlend proxy at `0xcd78874E6625557C3C50891969ac1040DE26E097`.
The current implementation address is `0x009b52e26546bC8738B5fDE50F8650DA837B04cc`; do not send user vault actions to the implementation address.

`VITE_FLUENT_AUTHORIZE_URL` and `VITE_FLUENT_RPC_URL` are optional runtime overrides for local development or custom infrastructure. `VITE_FLUENT_CLIENT_ID` is also optional; omit it for the default origin-derived builder flow.

## Writes

The app uses the same ZeroDev account abstraction path as the chess example:

```ts
const op = widget.createBatchOp({
  button: {
    label: "Approve + deposit",
    pendingLabel: "Submitting batch",
    successLabel: "Deposit submitted",
  },
  calls: [
    {
      id: "approve-asset",
      label: "Approve asset",
      to: asset,
      abi: erc20Abi,
      method: "approve",
      args: [vault, assets],
    },
    {
      id: "deposit-vault",
      label: "Deposit into vault",
      to: vault,
      abi: vaultAbi,
      method: "deposit",
      args: [assets, account],
    },
  ],
});

await op.execute();

await smartAccount.sendTransaction(
  withdraw(vault, assets, account, account),
);
```

Deposit batches ERC-20 approval and ERC-4626 deposit into one user operation. Withdrawal is a single ERC-4626 transaction from the Fluent smart account. The Withdraw control is only shown when the connected smart account holds vault shares.

## Delegated Sessions

The widget also exposes a builder-readable permission API:

```ts
const permission = await widget.createPermissionSession({
  label: "Manage stBlend vault position",
  delegate: thirdPartyAddress,
  expiresAt,
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

The SDK maps `{ equals }` and `{ max }` into ZeroDev ABI parameter rules, so the delegated session cannot change the spender, receiver, owner, target contract, function selector, or configured maximum amount.
