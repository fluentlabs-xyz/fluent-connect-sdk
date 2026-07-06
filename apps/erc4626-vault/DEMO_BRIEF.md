# stBlend Vault Demo Brief

This is a Fluent Connect demo app for an ERC-4626 vault on testnet.

The user connects only through the Fluent widget. After login, the app derives the user's ZeroDev smart account and uses that account as the vault receiver and owner.

The app reads the vault address from `config.json`, reads the underlying token directly from the vault's `asset()` function, and then loads ERC-4626 state: total assets, shares, rewards, capacity, wallet balance, allowance, and max withdrawal.

For a normal deposit, the app uses `widget.createBatchOp()` to submit ERC-20 `approve` and ERC-4626 `deposit` as one smart-account user operation. For withdrawal, it sends one ERC-4626 `withdraw` transaction from the same Fluent smart account. The Withdraw button only appears when the connected account actually holds vault shares.

The delegated-session part demonstrates account abstraction permissions. The builder calls `widget.createPermissionSession()` with a readable policy: approve only this vault, deposit only back to the user's smart account, and withdraw only to the configured third-party receiver. The SDK converts those readable rules into ZeroDev call-policy parameter constraints.

The important point for builders is that they do not need to own the wallet, implement Privy, or hand-roll ZeroDev policy encoding. They describe the app action through the Fluent widget, and the SDK turns it into scoped account-abstraction execution.
