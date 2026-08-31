# Style leak harness

A host app whose only job is to make the widget's stylesheet misbehave visibly.

`@fluent.xyz/connect/styles.css` used to ship rules that applied to the whole
page rather than to the widget: Tailwind's Preflight (`*`, `html`), a `body`
background and colour, and design tokens on `:root` under the shadcn names an
integrator is likely to be using themselves. Symptoms ranged from an app's text
turning white to native `<dialog>` elements no longer centring.

None of the other demo apps can catch that. `apps/chess` imports Tailwind itself,
so its own Preflight masks ours, and no demo app defines CSS custom properties,
so a token collision has nothing to collide with.

## Running it

```bash
pnpm --filter @fluent.xyz/connect build:css   # required — see below
pnpm --filter app-style-harness dev           # http://localhost:5180
```

The app resolves `@fluent.xyz/connect/styles.css` to the **built**
`dist/fluent-connect.css`, because that is the file integrators install. Editing
a stylesheet in `packages/connect/src/styles/` does nothing here until you
rebuild.

## Reading the result

Every card states what it expects. In short: the page should look like a plain,
light, serif document, and the widget's own Connect button in the corner should
still be dark. Anything of the widget's appearance showing up in the page is a
leak.

Programmatic checks worth running in the console:

```js
getComputedStyle(document.querySelector('.card ul')).paddingLeft  // "40px", not "0px"
getComputedStyle(document.documentElement).getPropertyValue('--background') // the host's "#ffffff"
document.querySelector('.dark-probe').closest('.dark')            // null
```

To confirm the harness still detects a regression rather than passing
vacuously, re-introduce the old global rules and watch every probe fail:

```js
const s = document.createElement('style');
s.textContent = `
  *,::before,::after { box-sizing:border-box; border:0 solid; margin:0; padding:0 }
  :root { --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0) }
`;
document.head.appendChild(s);
```

The host dialog then opens in the top-left corner instead of centred, the page
turns dark, and list indentation collapses.

## Constraints when editing

- **No CSS reset, and never `@import "tailwindcss"`.** Browser defaults are the
  control group; a reset here would hide what this app exists to show.
- **Keep it light and serif**, and keep the `:root` token names aligned with
  shadcn/ui — the contrast and the collision are the test.
- **No wallet functionality.** The widget only needs to mount for its stylesheet
  to be in play.
