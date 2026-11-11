# Public API

Rules for the names, errors, options and types this repository publishes. A removed rule keeps
its ID unused, so an ID always names the same rule.

Every rule carries its source in brackets: `[measured: <path>]` for what the code already does,
`[ADR n]` for a decision recorded in `docs/adr/`, `[seen: review]` for a defect a review found,
and `[decided <date>]` for the design session that wrote the rule.

### A1 The root JavaScript symbol API is exactly what `index.ts` exports

The names a builder can import from `@fluent.xyz/connect` are the names
`packages/connect/src/index.ts` exports: the ones it lists one by one, and every name the modules
behind its `export *` lines export. Adding, renaming or removing one of them is a deliberate act,
named in the pull request's `## Risk`, including when it happens indirectly, by changing what a
re-exported module exports.

This rule governs JavaScript symbols and nothing else. The package's subpath exports
(`./internal`, `./styles.css`, `./package.json`) are outside it and are governed by
`packages/connect/package.json#exports`; `pnpm --filter @fluent.xyz/connect lint:pack` is what
checks that shape. `./internal` is the Internal entry, `packages/connect/src/internal.ts`, whose
names are promised nothing and held by no lock [ADR 8] [measured:
`packages/connect/test/exports.test.ts`; decided 2026-10-15].

### A2 A new exported name carries the product name

`useFluentX`, `createFluentX`, `getFluentX`, `FluentX`, `FLUENT_X`: the product name sits on the
concept the name is about, which is what keeps an import readable in a builder's own module graph.
`useLinkX` and `AccountAvatar` predate this rule and stay; the rule binds a name a diff adds
[decided 2026-10-15].

### A3 An error crossing the public API has the shape of `FluentAuthError`

A class extending `Error` that sets `name` to its own class name and carries a `code` from a
string-literal union, declared once, in the module that owns its code union, and exported from
the root entry together with that union, so a builder can branch on `code` without matching a
message [measured: `packages/connect/src/core/authToken.ts`, `FluentAuthError` and
`FluentAuthErrorCode`].

### A4 A config option is optional, defaulted and validated once

Give it a documented default, validate it where the config is resolved, and fail with a message
that names the option so the builder knows which value to fix
[measured: `FluentWidgetConfigError` in `packages/connect/src/core/config.ts`,
"FluentWidgetConfig.appId is required"].

### A5 Values from outside are `unknown` until narrowed

A service response, a wallet's reply, a builder's argument: type it `unknown` and narrow it at
the boundary. A `as` cast or an `@ts-expect-error` carries a one-line comment saying why it is
safe [decided 2026-10-15].

### A6 A breaking change to A1 is marked in the commit and the pull request

The commit type takes a `!`, and the pull request's `## Risk` section names the old name, the new
one and what a builder has to change [decided 2026-10-15].

### A7 A package reaches another package by its name

`import { fluent } from "@fluent.xyz/connect-sdk"`, never a relative path into another package's
`src` [measured: no cross-package `src` import in `packages/*/src`].

### A8 The lock tests change only by the maintainer's own edit

`packages/connect/test/exports.test.ts`, `closure.test.ts` and `vendorMarkers.test.ts` hold the
public API literally: the export list, the closure of every kept name over the package's own
types and the listed platform packages, and the vendor words no kept declaration may speak. A
failure in one of them means the change broke the public API: fix the change, never the test.
Adding, removing or renaming a name, allowing a new package or exempting a new member is the
maintainer's own edit of the lock, named in the pull request's `## Risk` like any other A6
change; an agent does not edit these files, nor the census they read
(`packages/connect/test/apiCensus.ts`) or its fixture, to make a failure pass
[decided 2026-10-25].
