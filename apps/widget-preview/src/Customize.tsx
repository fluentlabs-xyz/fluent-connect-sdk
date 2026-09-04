import type { FluentWidgetConfig } from "@fluent.xyz/connect";
import {
  FluentWidgetConnectButton,
  FluentWidgetNetworkProvider,
  getFluentExplorerBaseUrl,
  resolveFluentWidgetNetworkFromEnv,
} from "@fluent.xyz/connect";
import { FluentAccountDrawer } from "@fluent.xyz/connect/internal/FluentAccountDrawer";
import {
  FluentPortalContainerProvider,
  WIDGET_STYLE_SCOPE,
} from "@fluent.xyz/connect/internal/portalContainer";
import { Button } from "@fluent.xyz/connect/internal/ui/button";
import { Label } from "@fluent.xyz/connect/internal/ui/label";
import { WalletMenuActionCard } from "@fluent.xyz/connect/internal/WalletMenuActionCard";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { previewScenarios } from "./previewScenarios";

const previewConfig: FluentWidgetConfig = {
  // Auth demo dev partner, kept on purpose: this harness never signs in or sponsors,
  // the config only has to resolve.
  partnerId: "partner_8908941315934a06b738c6804ce26132",
  privyClientId: "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1",
  network: resolveFluentWidgetNetworkFromEnv() ?? "testnet",
  appName: "Fluent Widget Preview",
};

/** A themable color; opacity below 100 becomes a color-mix toward transparent. */
type ColorValue = { color: string; opacity: number };

const DEFAULTS = {
  background: { color: "#000000", opacity: 100 },
  text: { color: "#ffffff", opacity: 100 },
  accent: { color: "#5011ff", opacity: 100 },
  buttonBackground: { color: "#ffffff", opacity: 10 },
  buttonText: { color: "#ffffff", opacity: 100 },
  tabsBackground: { color: "#ffffff", opacity: 10 },
  tabsActiveBackground: { color: "#ffffff", opacity: 10 },
  tabsText: { color: "#ffffff", opacity: 60 },
  tabsActiveText: { color: "#ffffff", opacity: 100 },
  pageBackground: { color: "#0a0a0a", opacity: 100 },
};

type ThemeColors = typeof DEFAULTS;

function cssColor({ color, opacity }: ColorValue): string {
  return opacity >= 100 ? color : `color-mix(in oklab, ${color} ${opacity}%, transparent)`;
}

function themeVars(colors: ThemeColors): Record<string, string> {
  return {
    "--background": cssColor(colors.background),
    "--popover": cssColor(colors.background),
    "--foreground": cssColor(colors.text),
    "--popover-foreground": cssColor(colors.text),
    "--secondary-foreground": cssColor(colors.text),
    "--muted-foreground": `color-mix(in oklab, ${colors.text.color} 60%, transparent)`,
    /* Solid control color: the switch thumb and ghost-button hovers use it. */
    "--primary": colors.buttonBackground.color,
    "--button": cssColor(colors.buttonBackground),
    "--button-foreground": cssColor(colors.buttonText),
    "--tabs": cssColor(colors.tabsBackground),
    "--tabs-foreground": cssColor(colors.tabsText),
    "--tabs-active": cssColor(colors.tabsActiveBackground),
    "--tabs-active-foreground": cssColor(colors.tabsActiveText),
    "--brand": cssColor(colors.accent),
  };
}

/**
 * The exact override block a host app would ship. Injected into a <style> tag
 * (rather than inline vars on a wrapper) so portaled UI — selects, drawers —
 * picks the colors up too. The second selector matters: drawer and select
 * popups re-apply `.dark` on themselves, which would otherwise beat an
 * override inherited from the `.fluent-root` container.
 */
function themeCss(colors: ThemeColors): string {
  const declarations = Object.entries(themeVars(colors))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `.fluent-root.dark,\n.fluent-root .dark {\n${declarations}\n}`;
}

/**
 * The sidebar renders inside its own `.fluent-root dark` scope so the widget's
 * shadcn components look identical here — but the live theme override targets
 * that same scope. Pinning the themed variables inline (inline style beats any
 * stylesheet rule) keeps the controls stable while the preview recolors.
 */
const SIDEBAR_THEME = themeVars(DEFAULTS) as CSSProperties;

function ColorField({
  label,
  value,
  onChange,
  withOpacity = false,
}: {
  label: string;
  value: ColorValue;
  onChange: (value: ColorValue) => void;
  withOpacity?: boolean;
}) {
  return (
    <Label className="justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
      <span className="text-sm font-normal">{label}</span>
      <span className="flex items-center gap-2">
        {withOpacity && (
          <span className="flex items-center gap-0.5 font-mono text-xs text-muted-foreground">
            <input
              type="number"
              min={0}
              max={100}
              value={value.opacity}
              onChange={(event) =>
                onChange({
                  ...value,
                  opacity: Math.min(100, Math.max(0, Number(event.target.value))),
                })
              }
              className="w-11 rounded-md border border-input bg-transparent px-1 py-0.5 text-right text-xs text-foreground outline-none focus-visible:border-ring"
            />
            %
          </span>
        )}
        <span className="font-mono text-xs text-muted-foreground">{value.color}</span>
        <input
          type="color"
          value={value.color}
          onChange={(event) => onChange({ ...value, color: event.target.value })}
          className="size-7 shrink-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent p-0.5"
        />
      </span>
    </Label>
  );
}

export default function Customize() {
  const [colors, setColors] = useState<ThemeColors>(DEFAULTS);
  const [copied, setCopied] = useState(false);

  const scenario = previewScenarios.find((s) => s.id === "mixed")!;
  const session = scenario.session!;
  const address = session.wallet.smartAccountAddress;
  const network = previewConfig.network ?? "testnet";

  const [accountOpen, setAccountOpen] = useState(true);
  const [tab, setTab] = useState("home");
  const [gasPaymentToken, setGasPaymentToken] = useState("BLEND");
  const [silentSigning, setSilentSigning] = useState(false);

  // Mirror the real widget's settings navigation: Back returns to the last
  // non-settings tab, and closing the drawer while in Settings resets it.
  const lastTabRef = useRef("home");
  useEffect(() => {
    if (tab !== "settings") lastTabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    if (!accountOpen && tab === "settings") setTab(lastTabRef.current);
  }, [accountOpen, tab]);

  const handleAccountMenuAction = (value: string | null) => {
    if (value === "explorer") {
      const popup = window.open(
        `${getFluentExplorerBaseUrl(network)}/address/${address}`,
        "_blank",
        "noopener,noreferrer",
      );
      if (popup) popup.opener = null;
    } else if (value === "copy") {
      navigator.clipboard.writeText(address);
    } else if (value === "settings") {
      setTab("settings");
    } else if (value === "disconnect") {
      setAccountOpen(false);
    }
  };

  useEffect(() => {
    const style = document.createElement("style");
    style.id = "fluent-customize-theme";
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    const style = document.getElementById("fluent-customize-theme");
    if (style) style.textContent = themeCss(colors);
  }, [colors]);

  const setColor = (key: keyof ThemeColors) => (value: ColorValue) => {
    setCopied(false);
    setColors((current) => ({ ...current, [key]: value }));
  };

  const copySnippet = async () => {
    await navigator.clipboard.writeText(themeCss(colors));
    setCopied(true);
  };

  return (
    <div className="flex min-h-screen bg-neutral-950 font-sans text-white antialiased">
      {/* Controls — built from the widget's own shadcn components, inside the
          same style scope, so the sidebar looks like the widget it themes. */}
      <aside
        className="fluent-root dark flex max-h-screen w-80 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-background px-5 py-8 text-foreground"
        style={SIDEBAR_THEME}
      >
        <header className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.055em] text-muted-foreground">
            Fluent Widget
          </span>
          <h1 className="text-xl font-medium tracking-tight">Customize</h1>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Colors apply through CSS variables on <code className="rounded bg-foreground/10 px-1 py-0.5">.fluent-root</code>,
            exactly as a host app would override them.
          </p>
        </header>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Core</span>
          <ColorField label="Background" value={colors.background} onChange={setColor("background")} />
          <ColorField label="Text" value={colors.text} onChange={setColor("text")} />
          <ColorField label="Accent" value={colors.accent} onChange={setColor("accent")} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Button</span>
          <ColorField
            label="Background"
            value={colors.buttonBackground}
            onChange={setColor("buttonBackground")}
            withOpacity
          />
          <ColorField label="Text" value={colors.buttonText} onChange={setColor("buttonText")} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Tabs</span>
          <ColorField
            label="Background"
            value={colors.tabsBackground}
            onChange={setColor("tabsBackground")}
            withOpacity
          />
          <ColorField
            label="Active background"
            value={colors.tabsActiveBackground}
            onChange={setColor("tabsActiveBackground")}
            withOpacity
          />
          <ColorField
            label="Text"
            value={colors.tabsText}
            onChange={setColor("tabsText")}
            withOpacity
          />
          <ColorField
            label="Active text"
            value={colors.tabsActiveText}
            onChange={setColor("tabsActiveText")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Host app</span>
          <ColorField
            label="Page background"
            value={colors.pageBackground}
            onChange={setColor("pageBackground")}
          />
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            setColors(DEFAULTS);
            setCopied(false);
          }}
        >
          Reset to defaults
        </Button>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-muted-foreground">CSS for your app</span>
            <Button variant="secondary" size="xs" onClick={copySnippet}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-foreground/5 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {themeCss(colors)}
          </pre>
        </div>
      </aside>

      {/* Preview: the widget's real composition — connect button toggling the
          account drawer (dropdown, settings, wallet menu), portaled exactly as
          in a host app. Non-modal and pinned open so colors stay tweakable. */}
      <main
        className="flex flex-1 flex-col items-start gap-4 px-10 py-14 transition-colors"
        style={{ backgroundColor: cssColor(colors.pageBackground) }}
      >
        <FluentPortalContainerProvider>
          {/* A column, not a row: the open drawer overlays the right side, and
              stacked buttons stay clear of it even on narrow windows. */}
          <div className="flex flex-col items-start gap-4">
            <div className={WIDGET_STYLE_SCOPE}>
              <FluentWidgetConnectButton connected={false} onClick={() => {}} />
              <FluentWidgetNetworkProvider network={network}>
                <FluentAccountDrawer
                  accountOpen={accountOpen}
                  setAccountOpen={setAccountOpen}
                  hasConnectedAccount
                  isMobile={false}
                  accountMenuAddress={address}
                  onAccountMenuAction={handleAccountMenuAction}
                  settingsOpen={tab === "settings"}
                  onCloseSettings={() => setTab(lastTabRef.current)}
                  modal={false}
                  disablePointerDismissal
                  connectButton={
                    <FluentWidgetConnectButton
                      connected
                      addressLabel={`${address.slice(0, 6)}...${address.slice(-4)}`}
                      onClick={() => setAccountOpen((current) => !current)}
                    />
                  }
                >
                  <WalletMenuActionCard
                    track={() => {}}
                    session={session}
                    smartAccountAddress={address}
                    faucetBusy={false}
                    onFaucet={() => {}}
                    config={previewConfig}
                    gasPaymentToken={gasPaymentToken}
                    onGasPaymentTokenChange={setGasPaymentToken}
                    silentSigningEnabled={silentSigning}
                    onSilentSigningChange={setSilentSigning}
                    onDisconnect={() => setAccountOpen(false)}
                    onConnectWithX={() => {}}
                    tab={tab}
                    onTabChange={setTab}
                  />
                </FluentAccountDrawer>
              </FluentWidgetNetworkProvider>
            </div>
          </div>
          <p className="max-w-52 text-xs leading-relaxed text-white/40">
            The connected button toggles the real account drawer on the right.
          </p>
        </FluentPortalContainerProvider>
      </main>
    </div>
  );
}
