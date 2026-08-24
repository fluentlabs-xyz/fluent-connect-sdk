# Sponsorship bench

A local bench for Fluent's partner-funded gas sponsorship. Four prepared actions against two
real Fluent testnet contracts, each sent through the `@fluent.xyz/connect` widget as one
UserOperation, each reporting **loudly** whether a partner's budget paid for it.

Beside the buttons is an explain panel that asks the sponsorship service the same question
without sending anything, and renders the verdict, the reason, which rule decided, the
segments the person landed in, and the balance.

## Why the `sponsored` badge exists

Any refusal in the sponsorship proxy is a flat `403`, and the widget then quietly pays the
account's own gas. On screen, "broken" and "working but not sponsoring" are otherwise the
same picture. So the badge is not read off which client we chose to send with — it is read
off the settled operation: which contract the EntryPoint actually charged, taken from the
UserOperation receipt's `paymaster` field, or from the `UserOperationEvent` log when the
bundler does not fill that field in.

- **SPONSORED** — a paymaster paid, and no ERC-20 gas token was selected.
- **PAID OWN GAS** — the smart account paid, whatever we asked for.
- **· unverified** — neither the receipt nor the event carried a paymaster, so the badge is
  the best guess available rather than a fact. It should be rare; treat it as a bug in the
  bundler response, not as noise.

The bench pins every send to native ETH gas, overriding the widget's own gas selector —
which defaults to BLEND. An ERC-20 gas token routes the operation through the ERC-20
paymaster, where sponsorship never enters the path, so inheriting that default would make
the bench report "PAID OWN GAS" for a partner and rule set that are in fact fine.

## Running it

```bash
pnpm --filter app-sponsorship-bench dev
```

| Env | Default | Notes |
|---|---|---|
| `VITE_PORT` | `5173` | The only localhost origin allowed for this Privy client. On any other port direct auth fails with `invalid_origin`, silently — the login button no-ops. `apps/erc4626-vault` and `apps/chess` share the port; run one at a time. |
| `VITE_SPONSORSHIP_URL` | `http://localhost:8076` | Both the widget's paymaster RPC (`/paymaster/{client_id}`) and this app's `/bench/decide`. |

The service side — Postgres, Redis, `admin-service`, `sponsorship-service` with
`--bench-enabled`, registering the partner, writing its rules, the reset SQL, and the ngrok
step a real sponsored send needs — is one runbook in the service repository:
`docs/sponsorship-bench-local.md` in `fluent-connect-service`. This app deliberately does not
restate it; two copies of a stack setup disagree within a week.

## The explain panel disappears, on purpose

`POST /bench/decide` is only registered when the service runs with `--bench-enabled`. With
the flag off it 404s, and the whole panel hides — leaving the buttons, the badge and the
widget, which is this app as a public demo. One conditional, not a second app.

A `500` is different and stays visible: the route exists and broke, which is a fault to read
rather than a mode to hide.

If you start this app before the service — the usual order — the panel will be hidden on
first paint and reappears when you click back into the browser tab. It re-asks on focus, but
only while it believes the endpoint is absent, so a demo with no service behind it never
polls.

## "Real sends decided by"

`/bench/decide` always evaluates with the new model. The `engine` field it returns is about
something else: which evaluator a **real** send through the widget would meet right now,
which is the service's `--model-engine-enabled` flag. When it reads `policy`, the dry run
on screen does not predict what a real send would do — the old flat `PartnerPolicy` engine
would decide that one. The panel says so in as many words, because the failure here is a
page confidently attributing a refusal to a rule that had no part in it.

## Two people, deliberately

The buttons always send as the **signed-in** account. The explain panel answers for the
**selected** person, which may instead be one of the four seeded DIDs, so a dry run works
with nobody logged in. The panel says which DID it answered for; do not read a dry run for
Verified Vera as an explanation of what your own Deposit just did.

## Why the amounts are zero

Every action except the approve carries a zero amount, and the approve needs no balance
either. Only the target and the 4-byte selector reach the evaluator, and a zero-amount call
carries exactly the same ones — so a signed-in account holding no BLEND cannot turn a policy
question into a revert. **Transfer shares** is the action the seeded rules deliberately do not
cover; it is there to be refused.
