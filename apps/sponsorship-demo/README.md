# Sponsorship demo

Two actions against real Fluent testnet contracts, one rule each — one question and four ways
of paying, side by side:

- **Dry-run** asks the sponsorship service what it would decide for **you** —
  `POST /paymaster/{partner_id}/preview`, identity from your Privy token, nothing sent.
  The verdict names the rule that decided and your segments. It is offered only while
  **sponsored** is selected: the question it asks is whether the partner's budget would
  cover the operation, and no other way of paying is going to ask it. Under the others the
  button is disabled with that sentence written out beside the selector.
- **Send** submits a real UserOperation through the `@fluent.xyz/connect` widget and
  reports **who actually paid** — read off the settled operation's `paymaster`, never off
  what the client asked for.
- **self**, first in the selector because it is what any account does without Fluent, sends
  the same call with the sponsorship paymaster deliberately not contacted
  (`gasPayment: { symbol: "ETH", sponsorship: "never" }`), so the smart account pays its own
  ETH. It is the control for **sponsored**: the same action, the same account, the only
  difference being whether the partner's budget was asked. Without it, "the budget paid" has
  nothing to be compared against.
- **Gas in BLEND** and **Gas in USDnr** send the same call through the ERC-20 paymaster
  instead. The sponsorship rules are never consulted on that path, and you pay.

Results accumulate on the action's row rather than replacing each other, because the
comparison between them is the thing worth seeing: a sponsored send and a token-paid send of
the same action sit on the row at once.

The two rules (configured on the partner, not in this code):

| Action | Rule |
|---|---|
| `transfer(you, 0)` on the BLEND token | sponsored for anyone |
| `deposit(0, you)` on the stBlend vault | sponsored for verified humans only |

The sponsored one is listed first on purpose: a visitor should see the path working before they
see it refuse.

Amounts are zero everywhere: a zero deposit and a zero transfer both succeed with an empty
balance, so a policy question never turns into a revert — only the target and the 4-byte
selector reach the evaluator.

## Why the badge exists

Any refusal in the sponsorship proxy is a flat `403`, and the widget then quietly pays the
account's own gas. On screen, "broken" and "working but not sponsoring" are otherwise the
same picture. So the badge reads the `paymaster` from the UserOperation receipt (or the
`UserOperationEvent` log): **SPONSORED** — the partner's budget paid; **PAID OWN GAS** —
the account paid, whatever was asked; **PAID IN TOKEN** — the ERC-20 paymaster charged you.

Who pays is chosen once, in the selector above the rows, and is explicit on every send —
never inherited from the widget's own gas selector, which defaults to BLEND. A button
labelled "Send" that quietly routed through the ERC-20 paymaster would skip the sponsorship
rules while claiming to test them, so the Send button carries the choice in its label. The
token ways of paying are also the one place this demo departs from its zero-amount principle — the payload
stays zero, but the gas is real, so a token send needs a real balance. The faucet in the
account menu claims BLEND; it says nothing about USDnr.

Where the ERC-20 paymaster does not answer, or the balance is empty, or the account is an
external wallet, the token options stay visible and disabled with the reason written out
underneath the selector. The same rule governs Dry-run when a way of paying other than
**sponsored** is chosen. A control that is off for an unstated reason reads as a broken
page, which is the one impression this demo exists to prevent.

## Who can do what

- **Fluent ID (Privy)**: every way of paying, and Dry-run while **sponsored** is selected.
  Dry-run identifies you by your Privy token; Send goes as your smart account, through the
  sponsorship paymaster or past it, according to the selector.
- **External wallet**: Send only, and it always pays its own gas — sponsorship covers
  smart accounts, and preview has no Privy token to identify you by. Token-paid gas is out
  too: it routes through a paymaster an EOA never uses. That contrast is the point of
  trying it.
- Different X accounts land in different segments — sign in with another one to see the
  verified-only rule flip.

## Running it

```bash
pnpm --filter app-sponsorship-demo dev
```

| Env | Default | Notes |
|---|---|---|
| `VITE_PORT` | `5173` | The only localhost origin allowed for this Privy client. On any other port direct auth fails with `invalid_origin`, silently. `apps/chess`, `apps/erc4626-vault` and `apps/auth-demo` share the port; run one at a time. |
| `VITE_SPONSORSHIP_URL` | `http://localhost:8076` | Both the widget's paymaster RPC (`/paymaster/{partner_id}`) and the dry-run's `/preview`. Point it at `https://sponsorship.fluent-connect.dev.gblend.xyz` to run against dev. **A deployed copy must set this**: the default is a localhost the visitor's browser resolves to their own machine, so sponsorship goes quiet rather than failing loudly. |
| `VITE_FLUENT_PARTNER_ID` | dev "Auth demo" partner | The partner whose rules decide. A local service mints its own partner — set this to that id (see `docs/sponsorship-bench-local.md` in `fluent-connect-service`); never edit the default in `consts.ts`. |

The partner's rules, budget and segments are service-side configuration; the local service
runbook is `docs/sponsorship-bench-local.md` in `fluent-connect-service`. This app
deliberately does not restate it.

Remaining sends under a per-user limit are not shown yet: `/preview` does not expose the
counter ([FLU-1276](https://linear.app/fluentlabs-xyz/issue/FLU-1276)).
