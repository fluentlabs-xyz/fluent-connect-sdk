# ZeroDev ERC20 Paymaster Demo

This demo verifies that the Fluent smart account can pay UserOp gas with BLEND through the self-funded ZeroDev ERC20 paymaster.

## Dashboard State

- Chain: Fluent Testnet `20994`
- Project: `893acc63-da39-4b57-8789-5784ed7f1969`
- Paymaster RPC: `https://rpc.zerodev.app/api/v3/893acc63-da39-4b57-8789-5784ed7f1969/chain/20994?selfFunded=true`
- BLEND token: `0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E`
- USDnr token: `0x092AE7564C6611a114C20C6df766B5B35A52334A`

The normal bundler RPC remains the same URL without `?selfFunded=true`.

## SDK Entry Points

The paymaster support lives in:

`packages/react/src/zerodevPaymaster.ts`

Key helpers:

- `createFluentZeroDevErc20PaymasterRpcUrl`
- `createFluentZeroDevErc20PaymasterClient`
- `createFluentZeroDevErc20PaymasterApprovalCall`
- `createFluentZeroDevErc20Paymaster`
- `sendFluentZeroDevErc20PaymasterDemo`

The chess demo exposes this through the `Test BLEND gas` button.

## What The Demo Sends

The demo builds a Kernel account client that uses:

- bundler transport: normal ZeroDev RPC
- paymaster transport: self-funded ERC20 paymaster RPC
- gas token: BLEND

It sends a zero-value no-op call to `0x000000000000000000000000000000000000dEaD`.

By default the demo also includes the ZeroDev-generated BLEND approval call for the ERC20 paymaster spender. The spender address is resolved with `zd_pm_accounts`; it is not hardcoded.

## Expected Result

On success:

- the app status shows `BLEND gas demo confirmed`
- `lastTxHash` updates to the receipt transaction hash
- the smart account BLEND balance or allowance changes according to ZeroDev paymaster accounting
- the paymaster native deposit decreases by the real native gas spent

If the first UserOp fails because approval cannot be consumed in the same UserOp, run the approval as a separate setup step using `createFluentZeroDevErc20PaymasterApprovalCall`, then rerun the BLEND gas demo without `includeApproval`.
