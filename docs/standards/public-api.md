# Public API

Rules for the names, errors, options and types this repository publishes. A removed rule keeps
its ID unused, so an ID always names the same rule.

Every rule carries its source in brackets: `[measured: <path>]` for what the code already does,
`[ADR n]` for a decision recorded in `docs/adr/`, `[seen: FLU-N]` for a defect a review found,
and `[decided 2026-10-15]` for the design session that wrote this file.

### A1 The root JavaScript symbol API is exactly what `index.ts` exports

The names a builder can import from `@fluent.xyz/connect` are the names
`packages/connect/src/index.ts` exports: the ones it lists one by one, and every name the modules
behind its `export *` lines export. Adding, renaming or removing one of them is a deliberate act,
named in the pull request's `## Risk`, including when it happens indirectly, by changing what a
re-exported module exports.

This rule governs JavaScript symbols and nothing else. The package's subpath exports
(`./styles.css`, `./package.json`) are outside it and are governed by
`packages/connect/package.json#exports`; `pnpm --filter @fluent.xyz/connect lint:pack` is what
checks that shape [measured: `packages/connect/src/index.ts`, 159 names listed one by one
(98 value, 61 type-only) and 7 `export *` lines; decided 2026-10-15].

### A2 A new exported name carries the product name

`useFluentX`, `createFluentX`, `getFluentX`, `FluentX`, `FLUENT_X`: the product name sits on the
concept the name is about, which is what keeps an import readable in a builder's own module graph.
The surface this rule arrived to is mixed and stays as it is; the rule binds a name a diff adds
[decided 2026-10-15; measured: of the 159 names `packages/connect/src/index.ts` lists one by one,
117 carry a form of `Fluent` and 42 do not: re-exported UI primitives (`Button`, `Dialog`,
`Icon`), L1 and bridge helpers (`getL1Chain`, `resolveBridgeAddresses`) and older names
(`useWidget`, `useLinkX`, `UserTokenStore`)].

### A3 An error crossing the public API has the shape of `FluentSettingsError`

A class extending `Error` that sets `name` to its own class name and carries a `code` from a
string-literal union, declared in the module that throws it and exported together with its code
type, so a builder can branch on `code` without matching a message
[measured: `packages/connect/src/core/settingsClient.ts:18`, `FluentSettingsError` and
`FluentSettingsErrorCode`].

### A4 A config option is optional, defaulted and validated once

Give it a documented default, validate it where the config is resolved, and fail with a message
that names the option so the builder knows which value to fix
[measured: `packages/connect/src/core/config.ts:536`, "FluentWidgetConfig.appId is required"].

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
[decided 2026-10-25, FLU-1622 criterion 1.7].
