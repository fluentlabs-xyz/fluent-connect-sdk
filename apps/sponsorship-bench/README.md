# Sponsorship demo

Two actions against real Fluent testnet contracts, one rule each, and for every action two
buttons:

- **Dry-run** asks the sponsorship service what it would decide for **you** —
  `POST /paymaster/{client_id}/preview`, identity from your Privy token, nothing sent.
  The verdict names the rule that decided and your segments.
- **Send** submits a real UserOperation through the `@fluent.xyz/connect` widget and
  reports **who actually paid** — read off the settled operation's `paymaster`, never off
  what the client asked for.

The two rules (configured on the partner, not in this code):

| Action | Rule |
|---|---|
| `deposit(0, you)` on the stBlend vault | sponsored for anyone, limited sends per user |
| `transfer(you, 0)` on the BLEND token | sponsored for verified humans only |

Amounts are zero everywhere: a zero deposit and a zero transfer both succeed with an empty
balance, so a policy question never turns into a revert — only the target and the 4-byte
selector reach the evaluator.

## Why the badge exists

Any refusal in the sponsorship proxy is a flat `403`, and the widget then quietly pays the
account's own gas. On screen, "broken" and "working but not sponsoring" are otherwise the
same picture. So the badge reads the `paymaster` from the UserOperation receipt (or the
`UserOperationEvent` log): **SPONSORED** — the partner's budget paid; **PAID OWN GAS** —
the account paid, whatever was asked. Every send is pinned to native ETH gas: an ERC-20
gas token would route through the ERC-20 paymaster, where sponsorship never enters the path.

## Who can do what

- **Fluent ID (Privy)**: both buttons. Dry-run identifies you by your Privy token; Send
  goes as your smart account through the sponsorship path.
- **External wallet**: Send only, and it always pays its own gas — sponsorship covers
  smart accounts, and preview has no Privy token to identify you by. That contrast is the
  point of trying it.
- Different X accounts land in different segments — sign in with another one to see the
  verified-only rule flip.

## Running it

```bash
pnpm --filter app-sponsorship-bench dev
```

| Env | Default | Notes |
|---|---|---|
| `VITE_PORT` | `5173` | The only localhost origin allowed for this Privy client. On any other port direct auth fails with `invalid_origin`, silently. `apps/chess`, `apps/erc4626-vault` and `apps/auth-demo` share the port; run one at a time. |
| `VITE_SPONSORSHIP_URL` | `http://localhost:8076` | Both the widget's paymaster RPC (`/paymaster/{client_id}`) and the dry-run's `/preview`. Point it at `https://sponsorship.fluent-connect.dev.gblend.xyz` to run against dev. |

The partner's rules, budget and segments are service-side configuration; the local service
runbook is `docs/sponsorship-bench-local.md` in `fluent-connect-service`. This app
deliberately does not restate it.

Remaining sends under a per-user limit are not shown yet: `/preview` does not expose the
counter ([FLU-1276](https://linear.app/fluentlabs-xyz/issue/FLU-1276)).
