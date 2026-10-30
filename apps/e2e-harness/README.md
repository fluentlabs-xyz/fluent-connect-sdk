# E2E harness

The real `FluentWidget` in a real browser, driven by Playwright. Nothing on this page reaches
Privy or a network:

- **Privy** is `src/fakePrivy.tsx`, passed through the widget's `privyAdapter` prop. Email login
  takes any address and the code `123456`; the Signer is a viem account on Anvil's first
  development key, so its signatures are real.
- **The network** is `e2e/fakeNetwork.ts`, installed with `page.route` by every test: the Fluent
  RPC, `fluent-connect-service`, prices, FluentScan and Sepolia. A request to a host it does not
  fake is aborted and fails the test, so a new endpoint cannot slip in unnoticed.

## Running it

```bash
pnpm --filter @fluent.xyz/connect build          # the harness uses the built stylesheet
pnpm --filter app-e2e-harness exec playwright install chromium   # once per machine
pnpm --filter app-e2e-harness test:e2e
```

`pnpm --filter app-e2e-harness test:e2e --ui` opens Playwright's UI mode, and
`--headed` shows the browser. CI runs `pnpm exec turbo run test:e2e` against the production
build, and uploads the HTML report with a trace of every failed test.

## Scenarios

The query string picks the starting state:

- `/` — signed out.
- `/?signedInAs=<email>` — that person is already signed in and their Signer exists, as after a
  page reload.

A test changes what the fake network answers before it navigates, for example
`network.settings.quick_sign = false`, and reads back what the widget sent with
`network.callsTo("PATCH", "/me/settings")`.

## Writing a test

- Name it `<flow>.spec.ts` in `e2e/`. Vitest never runs these files, and Playwright never runs
  a `.test.ts` file.
- Import `test` and `expect` from `./fixtures`, not from `@playwright/test`: the fixture is what
  installs the fake network and checks for unfaked hosts.
- Find elements the way a person does: by role and accessible name, then by label. The drawer and
  the sign-in dialog rename themselves per step, so `fixtures.ts` finds them by `data-slot`.

## Opening it by hand

`pnpm --filter app-e2e-harness dev` serves it on http://localhost:5190. Without Playwright's
routes the requests go to the real testnet: the Fluent ID still resolves, because it is read from
the chain, but `fluent-connect-service` refuses the fake Privy tokens. The page is for tests and
for looking at a state a test reached, not for trying the widget out.
