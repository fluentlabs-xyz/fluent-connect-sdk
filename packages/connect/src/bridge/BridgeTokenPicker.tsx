import { Check, ChevronDown, ChevronLeft, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Icon, type IconName } from "../components/Icon";
import { VISUAL_BY_DEFAULT_SYMBOL } from "../components/tokenVisuals";
import { CHAIN_BADGE } from "./ActivityTokenTile";

/** Which side of the bridge a token sits on, which decides its chain badge. */
export type BridgeTokenSide = "source" | "destination";

/**
 * Keyed by string rather than by `BridgeTokenSymbol`: the Receive side also
 * names tokens that only exist on Fluent, which the bridge's own union does not
 * cover. A symbol with no glyph still gets its tile, so the row keeps its shape.
 */
const TOKEN_ICONS: Record<string, IconName | undefined> = {
  ETH: "eth",
  USDnr: "usdnr",
  USDC: "usdc",
};

/**
 * The token's glyph on its tile, with the chain it sits on badged in the corner
 * — the Portal's pill icon, drawn with the token list's tiles and Activity's
 * chain badges. The badge ring is solid: it sits on the glyph, so alpha would
 * let it show through instead of separating the two.
 *
 * A token that is not one of Fluent's own (`trusted` false) never gets a glyph by
 * its symbol, since anything can call itself BLEND: it shows its `logoURI`, or its
 * initial.
 */
export function TokenChainIcon({
  symbol,
  chain,
  size = "sm",
  logoURI,
  trusted = true,
}: {
  symbol: string;
  chain: BridgeTokenSide;
  size?: "sm" | "lg";
  logoURI?: string;
  trusted?: boolean;
}) {
  const visual = trusted ? VISUAL_BY_DEFAULT_SYMBOL[symbol] : undefined;
  const badge = chain === "source" ? CHAIN_BADGE.l1_to_l2 : CHAIN_BADGE.l2_to_l1;
  const icon = trusted ? (TOKEN_ICONS[symbol] ?? visual?.icon) : undefined;
  const onBrandTile = visual?.iconClassName.includes("text-white");
  const large = size === "lg";
  const glyph = large ? "size-5" : "size-4";
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`flex items-center justify-center overflow-hidden rounded-full ${large ? "size-10" : "size-7"} ${visual?.bgClassName ?? "bg-foreground/10"}`}
      >
        {icon ? (
          <Icon name={icon} className={onBrandTile ? `${glyph} text-white` : glyph} />
        ) : logoURI ? (
          // An <img>, never inlined: the URL is an integrator's or a stranger's.
          <img src={logoURI} alt="" aria-hidden="true" className="size-full object-cover" />
        ) : (
          <span className="text-xs font-medium">{symbol.slice(0, 1)}</span>
        )}
      </span>
      <span
        className={`absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full ring-2 ring-neutral-900 ${large ? "size-4" : "size-3.5"} ${badge.bgClassName}`}
      >
        <Icon name={badge.icon} className={`size-2 ${badge.iconClassName}`} />
      </span>
    </span>
  );
}

/**
 * The pill a token card shows, opening the picker. Same height as the static
 * chip, so a card with a choice and a card without one line up.
 */
export function TokenPickerTrigger({
  symbol,
  chain,
  label,
  onOpen,
  logoURI,
  trusted,
  disabled,
}: {
  symbol: string;
  chain: BridgeTokenSide;
  label: string;
  onOpen: () => void;
  logoURI?: string;
  trusted?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      disabled={disabled}
      className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground/[0.06] py-0 pl-2 pr-3 text-sm font-medium text-foreground transition-colors enabled:hover:bg-foreground/10 disabled:opacity-50"
      onClick={onOpen}
    >
      <TokenChainIcon symbol={symbol} chain={chain} logoURI={logoURI} trusted={trusted} />
      <span className="leading-none whitespace-nowrap">{symbol}</span>
      <ChevronDown className="size-4 text-foreground/70" />
    </button>
  );
}

/** One row of the picker. */
export type BridgeTokenOption = {
  /**
   * What `value` and `onSelect` name the row by; the symbol when absent. A list where two
   * tokens may share a symbol — Send's, which holds tokens the person added — keys by identity.
   */
  id?: string;
  symbol: string;
  name: string;
  /** What picking it means, shown under the name in place of it. */
  caption?: string;
  /** Listed but not pickable; `caption` says why. */
  disabled?: boolean;
  /** A logo for a token with no glyph of its own. */
  logoURI?: string;
  /** False for a token that is not one of Fluent's own; see `TokenChainIcon`. */
  trusted?: boolean;
};

function matches(option: BridgeTokenOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    option.symbol.toLowerCase().includes(needle) || option.name.toLowerCase().includes(needle)
  );
}

/**
 * The token list the Bridge page opens in place of its form, as a wallet's own
 * "Select token" view: a way back, a search, and one row per token. Picking a
 * row hands its id back and the form returns; the form owns the choice, so
 * leaving without picking changes nothing.
 */
export function BridgeTokenPicker({
  options,
  value,
  chain,
  networkName,
  onSelect,
  onBack,
}: {
  options: readonly BridgeTokenOption[];
  /** The picked row's id (its symbol, unless the options name one). */
  value: string;
  chain: BridgeTokenSide;
  /** The chain every option sits on, named above the list. */
  networkName: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => options.filter((option) => matches(option, query)),
    [options, query],
  );

  return (
    // `fixed` rather than in the form's flow, so the view covers the drawer's own
    // "Swap" header instead of stacking a second way back under it. The drawer
    // panel is transformed, which makes it the containing block: `inset-0` is the
    // panel, not the viewport, wherever the Bridge page is mounted in a drawer.
    // The radius is the panel's less its 1px border, which `inset-0` sits inside,
    // so the corners follow the panel's instead of squaring off over them.
    <div
      role="dialog"
      aria-label="Select token"
      className="fixed inset-0 z-10 flex flex-col gap-3 overflow-x-hidden overflow-y-auto rounded-[calc(min(var(--radius-4xl),24px)-1px)] bg-popover p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onBack();
        }
      }}
    >
      <div className="relative flex h-11 items-center justify-center">
        <button
          type="button"
          aria-label="Back"
          className="absolute left-0 inline-flex size-8 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
          onClick={onBack}
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="text-sm font-medium leading-none text-foreground">Select token</span>
      </div>

      <label className="flex h-11 items-center gap-2 rounded-full bg-foreground/[0.06] px-4 text-foreground/60 ring-1 ring-foreground/10 focus-within:ring-foreground/30">
        <Search className="size-4 shrink-0" />
        <input
          // The list is what the person came for; typing narrows it straight away.
          autoFocus
          type="search"
          aria-label="Search tokens"
          placeholder="Search by token name"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-foreground/40 sm:text-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <span className="px-1 text-xs text-foreground/50">{`Tokens on ${networkName}`}</span>

      {/* Rows drawn as Activity's are (`WalletMenuActivity`), each one rounded,
          so the two lists read as the same widget. */}
      {visible.length > 0 ? (
        <div role="listbox" aria-label="Tokens" className="flex flex-col gap-1">
          {visible.map((option) => {
            const id = option.id ?? option.symbol;
            const selected = id === value;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                className={`flex w-full items-center gap-3 rounded-xl p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
                  selected ? "bg-white/10" : "enabled:hover:bg-white/10"
                }`}
                onClick={() => onSelect(id)}
              >
                <TokenChainIcon
                  symbol={option.symbol}
                  chain={chain}
                  size="lg"
                  logoURI={option.logoURI}
                  trusted={option.trusted}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-medium leading-4 text-foreground">
                    {option.symbol}
                  </span>
                  <span className="truncate leading-4 text-muted-foreground">
                    {option.caption ?? option.name}
                  </span>
                </span>
                {selected ? <Check className="size-4 shrink-0 text-foreground/70" /> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1 rounded-xl bg-foreground/5 px-4 py-8 text-center">
          <span className="text-sm font-medium">No token found</span>
          <span className="text-xs opacity-50">{`Nothing matches “${query.trim()}”.`}</span>
        </div>
      )}
    </div>
  );
}
