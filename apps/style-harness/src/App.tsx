import { FluentWidget, type FluentWidgetConfig } from "@fluent.xyz/connect";
import { useRef } from "react";

// Hosted auth: nothing signs in, so no allow-listed origin is needed.
const config: FluentWidgetConfig = {
  // Auth demo dev partner, kept on purpose: this harness never signs in or sponsors,
  // the config only has to resolve.
  partnerId: "partner_8908941315934a06b738c6804ce26132",
  privyClientId: "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1",
  network: "testnet",
  appName: "Style Leak Harness",
  disableAnalytics: true,
};

function NativeDialogProbe() {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <div className="card">
      <h2>Native &lt;dialog&gt;</h2>
      <p className="expect">
        Expected: opens centred. A leaked universal margin reset pins it to a
        corner instead, because the browser centres modal dialogs with
        <code> margin: auto</code>.
      </p>
      <button className="plain" onClick={() => ref.current?.showModal()}>
        Open host dialog
      </button>
      <dialog className="host-dialog" ref={ref}>
        <h2>Host dialog</h2>
        <p>This belongs to the host app, not to the widget.</p>
        <button className="plain" onClick={() => ref.current?.close()}>
          Close
        </button>
      </dialog>
    </div>
  );
}

function Probes() {
  return (
    <div className="page">
      <h1>Widget style leak harness</h1>
      <p>
        A deliberately plain, light, serif page with <strong>no CSS reset of its
        own</strong>. Everything below should look like an ordinary unstyled
        document. Anything dark, cramped or sans-serif is the widget&rsquo;s
        stylesheet escaping its scope.
      </p>

      <div className="card">
        <h2>Inherited colour</h2>
        <p className="expect">
          Expected: dark text on white. White-on-white means the widget&rsquo;s
          <code> text-white</code> is being inherited by host content.
        </p>
        <p>The quick brown fox jumps over the lazy dog.</p>
      </div>

      <div className="card">
        <h2>Colour-scheme class</h2>
        <p className="expect">
          Expected: green. Red means a <code>.dark</code> ancestor wraps host
          content, which would also flip every <code>dark:</code> variant in a
          Tailwind host.
        </p>
        <p className="dark-probe">dark-probe</p>
      </div>

      <div className="card">
        <h2>Design tokens</h2>
        <p className="expect">
          Expected: both swatches use this page&rsquo;s palette — white
          background, near-black text. The widget once defined the same
          shadcn token names on <code>:root</code>; if it does again, these
          repaint themselves.
        </p>
        <p>
          <span className="swatch">--background / --foreground</span>{" "}
          <span className="swatch" style={{ borderColor: "var(--primary)" }}>
            --border / --primary
          </span>
        </p>
      </div>

      <div className="card">
        <h2>Default spacing and typography</h2>
        <p className="expect">
          Expected: browser defaults — the list is indented with bullets, the
          heading is larger than body text, and this page&rsquo;s serif font is
          in use. A leaked Preflight flattens all three.
        </p>
        <h3>A third-level heading</h3>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
        <blockquote>A block quote, indented by the browser.</blockquote>
      </div>

      <NativeDialogProbe />

      <div className="card">
        <h2>Widget chrome</h2>
        <p className="expect">
          The widget&rsquo;s own Connect button sits top-right and must still be
          dark — the fix scopes the widget&rsquo;s styling to itself, it does not
          remove it. Open it to check dialogs still render correctly.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return <FluentWidget config={config} mode="page" renderPage={() => <Probes />} />;
}
