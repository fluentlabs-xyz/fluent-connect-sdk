import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";

// Run the provider's real request callback with its state setters observed.
const installed = ts.transpileModule(
  readFileSync(new URL("./FluentWidget.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;

describe("inline login lifecycle", () => {
  it("opens inline direct login without remounting the Privy provider or game", () => {
    const start = installed.indexOf(
      "const requestPrivyLogin = useCallback(() => {",
    );
    const end = installed.indexOf("useEffect(() => {", start);
    const setPrivyEpoch = vi.fn();
    const setInlineLoginRequest = vi.fn();
    const pendingPrivyLoginRef = { current: false };
    const run = (authMode) =>
      runInNewContext(installed.slice(start, end) + "\nrequestPrivyLogin();", {
        useCallback: (callback) => callback,
        clearPrivyRecentLoginMethod() {},
        FLUENT_CONNECT_PRIVY_APP_ID: "fixture",
        pendingPrivyLoginRef,
        setPrivyEpoch,
        setInlineLoginRequest,
        resolvedConfig: { authMode },
      });
    run("direct");
    expect(setInlineLoginRequest).toHaveBeenCalledTimes(1);
    expect(setPrivyEpoch).not.toHaveBeenCalled();
    expect(pendingPrivyLoginRef.current).toBe(false);
    run("hosted");
    expect(setPrivyEpoch).toHaveBeenCalledTimes(1);
    expect(pendingPrivyLoginRef.current).toBe(true);
  });
  it("does not replay a consumed login request after a provider remount", () => {
    const source = ts.transpileModule(
      readFileSync(
        new URL("./FluentWidgetContent.tsx", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText;
    const guard = source.indexOf(
      "if (!directAuth || inlineLoginRequest <= handledInlineLoginRequest.current)",
    );
    expect(guard).toBeGreaterThan(-1);
    const start = source.lastIndexOf("useEffect(() => {", guard);
    const end = source.indexOf("const handleConnectWithX", guard);
    const handledInlineLoginRequest = { current: 0 };
    const setConnectOpen = vi.fn();
    const setDirectAuthRequested = vi.fn();
    const mount = (inlineLoginRequest) =>
      runInNewContext(source.slice(start, end), {
        useEffect: (effect) => effect(),
        directAuth: true,
        inlineLoginRequest,
        handledInlineLoginRequest,
        setHostedError: vi.fn(),
        setDirectAuthRequested,
        setConnectOpen,
      });
    mount(0);
    expect(setConnectOpen).not.toHaveBeenCalled();
    mount(1);
    expect(setConnectOpen).toHaveBeenCalledOnce();
    mount(1); // Quick sign rebuilds the subtree, but the intent lives above it.
    expect(setConnectOpen).toHaveBeenCalledOnce();
    mount(2); // A fresh explicit login still works.
    expect(setConnectOpen).toHaveBeenCalledTimes(2);
    expect(setDirectAuthRequested).toHaveBeenCalledTimes(2);
  });
});
