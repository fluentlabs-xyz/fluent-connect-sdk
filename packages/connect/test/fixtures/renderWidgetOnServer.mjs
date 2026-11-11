// Renders the built entry the way an SSR framework's request handler does: plain Node,
// no `window`, no `document`, no storage. `serverRender.node.test.ts` runs this file in a
// child process and reads the one JSON line it prints; nothing here is faked, because the
// point is that the real entry renders against a real absence of a browser.
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const consoleErrors = [];
const consoleWarnings = [];
console.error = (...args) => {
  consoleErrors.push(args.map(String).join(" "));
};
console.warn = (...args) => {
  consoleWarnings.push(args.map(String).join(" "));
};

const { FluentWidget, useFluentWidget } = await import("../../dist/index.js");

// The widget-preview harness's public testnet credentials: nothing signs in on a server
// render, the config only has to resolve.
const config = {
  appId: "app_8908941315934a06b738c6804ce26132",
  privyClientId: "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1",
  network: "testnet",
  appName: "Server render probe",
};

// What a real App's page does with the render context: read it where it renders.
function HostPage() {
  const { status, session } = useFluentWidget();
  return createElement("main", null, `host status: ${status}, session: ${String(session)}`);
}

const combos = {
  page: {
    config,
    mode: "page",
    renderPage: () => createElement("main", null, "host page content"),
  },
  home: { config, mode: "home" },
  hostContext: {
    config,
    mode: "page",
    renderPage: () => createElement(HostPage),
  },
  inlineButton: {
    config,
    mode: "page",
    connectButton: "inline",
    renderPage: () => createElement("main", null, "host page content"),
  },
  customButton: {
    config,
    mode: "page",
    connectButton: false,
    renderConnectButton: ({ onClick }) => createElement("button", { onClick }, "custom connect"),
    renderPage: () => createElement("main", null, "host page content"),
  },
};

const results = {};
for (const [name, props] of Object.entries(combos)) {
  try {
    results[name] = { html: renderToString(createElement(FluentWidget, props)) };
  } catch (error) {
    results[name] = { error: error instanceof Error ? error.message : String(error) };
  }
}

process.stdout.write(`${JSON.stringify({ results, consoleErrors, consoleWarnings })}\n`);
