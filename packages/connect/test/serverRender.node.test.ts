// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const probe = fileURLToPath(new URL("./fixtures/renderWidgetOnServer.mjs", import.meta.url));
const distEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distInternal = fileURLToPath(new URL("../dist/internal.js", import.meta.url));

type ProbeReport = {
  results: Record<string, { html?: string; error?: string }>;
  consoleErrors: string[];
  consoleWarnings: string[];
};

/**
 * `<FluentWidget>` must render on a server: an SSR framework's request handler
 * runs it in plain Node, where no `window`, `document` or storage exists, and an exception
 * there is the host's whole page answering HTTP 500. Vitest cannot prove that — Vite
 * transforms what these tests import, and the worker carries jsdom polyfills — so the render
 * under test runs in a child Node process against the built entry, the artifact a host
 * actually loads. Nothing is faked in that process. CI builds `dist` before the test step
 * (`turbo`'s `test` depends on `build`).
 */
describe("the widget on a server", () => {
  // One child process renders every combination; spawning Node and loading the entry
  // dominates the time, the same 60 s budget as `entryImport.node.test.ts`.
  const report: ProbeReport = JSON.parse(
    execFileSync(process.execPath, [probe], {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 60_000,
    })
      .trim()
      .split("\n")
      .at(-1) as string,
  );

  it.each([["page"], ["home"], ["inlineButton"], ["customButton"], ["hostContext"]])(
    "returns markup for the %s shape instead of throwing",
    (name) => {
      const result = report.results[name];
      expect(result.error).toBeUndefined();
      expect(result.html?.length).toBeGreaterThan(0);
    },
  );

  it("renders the App's own page content into the server markup", () => {
    expect(report.results.page.html).toContain("host page content");
  });

  it("answers useFluentWidget() on the server with the restoring status and no session", () => {
    // A server cannot know whether this browser holds a stored session, and `restoring` is
    // the status a builder is told to branch on before that is settled.
    expect(report.results.hostContext.html).toContain("host status: restoring, session: null");
  });

  it("logs no error and no warning while rendering", () => {
    // React's `useLayoutEffect does nothing on the server` lands here too: a warning per
    // render per host is the difference between surviving SSR and merely not crashing.
    expect(report.consoleErrors).toEqual([]);
    expect(report.consoleWarnings).toEqual([]);
  });
});

describe("the client boundary of the built entries", () => {
  it("marks both entries as client modules for React Server Components", () => {
    // Without the directive a Next.js App Router build evaluates the entry in its server
    // graph and dies on `createContext`. The directive must be the first thing in the file:
    // a directive prologue ends at the first statement.
    expect(readFileSync(distEntry, "utf8").startsWith('"use client";')).toBe(true);
    expect(readFileSync(distInternal, "utf8").startsWith('"use client";')).toBe(true);
  });

  it("keeps the Buffer polyfill the first import of the entry", () => {
    // The directive goes above it, nothing else does: the polyfill must run before any
    // Privy or ZeroDev module (see `src/index.ts`).
    const entry = readFileSync(distEntry, "utf8");
    const firstImport = entry.match(/^import[^;]*;/m)?.[0];
    expect(firstImport).toBe("import './polyfills/buffer.js';");
  });
});
