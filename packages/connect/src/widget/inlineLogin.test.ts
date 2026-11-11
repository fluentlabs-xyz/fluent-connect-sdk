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

describe("the Direct login request", () => {
  it("asks for the Direct login dialog without remounting the Privy provider", () => {
    const start = installed.indexOf("const requestPrivyLogin = useCallback(() => {");
    const end = installed.indexOf("useEffect(() => {", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const setInlineLoginRequest = vi.fn();
    const clearPrivyRecentLoginMethod = vi.fn();
    runInNewContext(installed.slice(start, end) + "\nrequestPrivyLogin();", {
      useCallback: (callback: () => void) => callback,
      clearPrivyRecentLoginMethod,
      privyAppId: "fixture",
      setInlineLoginRequest,
    });
    // The one way in: a request the dialog consumes, under the Privy provider that
    // is already mounted. Nothing here remounts it.
    expect(setInlineLoginRequest).toHaveBeenCalledTimes(1);
    expect(clearPrivyRecentLoginMethod).toHaveBeenCalledWith("fixture");
  });
  it("does not replay a consumed login request after a provider remount", () => {
    const source = ts.transpileModule(
      readFileSync(new URL("./FluentWidgetContent.tsx", import.meta.url), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText;
    const guard = source.indexOf("if (inlineLoginRequest <= handledInlineLoginRequest.current)");
    expect(guard).toBeGreaterThan(-1);
    const start = source.lastIndexOf("useEffect(() => {", guard);
    const end = source.indexOf("const handleConnectWithX", guard);
    const handledInlineLoginRequest = { current: 0 };
    const setConnectOpen = vi.fn();
    const setDirectAuthRequested = vi.fn();
    const mount = (inlineLoginRequest: number) =>
      runInNewContext(source.slice(start, end), {
        useEffect: (effect: () => void) => effect(),
        inlineLoginRequest,
        handledInlineLoginRequest,
        setLoginError: vi.fn(),
        setDirectAuthRequested,
        setConnectOpen,
      });
    mount(0);
    expect(setConnectOpen).not.toHaveBeenCalled();
    mount(1);
    expect(setConnectOpen).toHaveBeenCalledOnce();
    // Quick sign rebuilds the subtree, but the request lives above it.
    mount(1);
    expect(setConnectOpen).toHaveBeenCalledOnce();
    // A new request opens the dialog again.
    mount(2);
    expect(setConnectOpen).toHaveBeenCalledTimes(2);
    expect(setDirectAuthRequested).toHaveBeenCalledTimes(2);
  });
});
