# fluent-connect-sdk

## What this repository is

An embeddable widget and SDK that gives builders a smart-account wallet experience on Fluent:
Direct login, account management, token balances and gas-sponsored execution. It is frontend
only; the HTTP service it calls is `fluent-connect-service`, a separate repository.

`CONTEXT.md` is the glossary. Every concept this repository has is defined there, and that
definition's term is the only name for it in code, docs and UI copy. `docs/adr/` is the record of
the decisions a change must not contradict without a new ADR.

On a conflict, an ADR in `docs/adr/` wins over a rule in `docs/standards/`, and a `CONTEXT.md`
term wins over any other word for its concept.

## Done means green

`.github/workflows/ci.yml` runs these three, on Node 22 and 24:

```bash
pnpm exec turbo run build
pnpm exec turbo run typecheck
pnpm exec turbo run test
```

One test file, once a `build` has produced the workspace packages' `dist/`:

```bash
pnpm --filter @fluent.xyz/connect exec vitest run src/core/config.test.ts
```

A change to `packages/connect/package.json` also runs
`pnpm --filter @fluent.xyz/connect lint:pack` (publint and are-the-types-wrong), which CI runs
only at release. Report the commands you ran and what they printed.

## Layout

- `packages/connect` is the only published package, `@fluent.xyz/connect`: the widget, its hooks
  and the public entry `src/index.ts`.
- `packages/connect-sdk` and `packages/registry` are private and bundled into it. A package
  reaches another by its package name, never through its `src` path.
- `apps/*` are demos: they import packages, and no package imports a demo.
- `config/*.env` holds non-secret demo config, loaded by `scripts/with-config.mjs`.
- `docs/adr/` holds the decisions, `docs/standards/` the coding rules the next section points to.
- `packages/connect/docs/` holds the builder guides, shipped in the package; the old one-file
  guide beside it is a stub that maps its sections there. `docs/api.md` is generated from the TSDoc by
  `pnpm --filter @fluent.xyz/connect docs:api`, and a test fails when it is stale.

## Standards

Each line below names the one file to read before writing that kind of change:

- Adding or changing a test, a fake or a fixture: `docs/standards/testing.md`.
- Adding, renaming or removing an export, a public error, a config option or a public type:
  `docs/standards/public-api.md`.
- Changing widget state, hooks, auth, session, User settings or asynchronous work in
  `packages/connect/src/widget` or `packages/connect/src/core`:
  `docs/standards/widget-runtime.md`.
- Changing behaviour a builder can observe, writing TSDoc, `README.md`, a guide in
  `packages/connect/docs/` or a comment, or adding or changing any JavaScript or TypeScript
  source line: `docs/standards/docs-and-comments.md`.

## Gotchas

- `import "./polyfills/buffer";` is the first statement of `packages/connect/src/index.ts`: the
  `Buffer` global must exist before any Privy or ZeroDev module runs. Nothing goes above it.
- `http://localhost:5173` is the only localhost origin Privy accepts for the demos, and Direct
  login happens in the App's own page, so a demo has to be served on that port and only one demo
  can run at a time.
- `@swapper-finance/deposit-sdk` stays in `server.deps.inline` in
  `packages/connect/vitest.config.ts`; Node's ESM resolver rejects its extensionless imports.
- `viem` and `@wagmi/connectors` are pinned in the root `package.json` under `pnpm.overrides`, so
  a version change belongs there and not in a package.
- Vitest runs the four projects `vitest.workspace.ts` lists; a test outside them never runs.
- `packages/connect/src/widget/kernelSignature.fork.test.ts` is skipped unless
  `FLUENT_KERNEL_SIGNATURE_TEST=1` is set; the `test:kernel-signature` script of
  `packages/connect` sets it.

## Commits and pull requests

Every commit in this repository is `<type>(<scope>): <title>` when every file it changes belongs
to one direct child of `packages/` or `apps/` at the pull request's base, the scope being that
directory's name (`connect`, `registry`, `chess`). It is `<type>: <title>` otherwise: a change to
root-owned paths only, a docs-only change, a change spanning more than one such directory, and a
repo-wide change. The types are `feat`, `fix`, `docs`, `refactor`, `test` and `chore`. A title is
lowercase, imperative and carries no trailing period; a breaking public change marks its type
with `!`.

A pull request targets `devel`, and its body follows `.github/pull_request_template.md`.

## Reviewing

A review applies every file in `docs/standards/` whose pointer trigger in the Standards section
the diff matches, and reports each breach on one line:

```
<file:line> | <rule ID> | <what>
```

for example:

```
packages/connect/src/widget/session.ts:88 | R2 | the token cache survives a new Fluent ID
```

What the three commands above already catch is not a review finding.
