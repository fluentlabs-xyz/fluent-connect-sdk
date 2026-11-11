import type { IconName } from "./Icon";

/**
 * How each Default token is drawn: which glyph, how big, and what tile sits behind it. Keyed
 * by symbol, so a caller looks a symbol up only when it trusts where the symbol came from: a
 * token that passed `isFluentDefaultToken`, or a symbol from the bridge's own config. A
 * contract's symbol is whatever its deployer chose, and anything calling itself BLEND would
 * otherwise get BLEND's icon and look official.
 */
export const VISUAL_BY_DEFAULT_SYMBOL: Record<
  string,
  { icon: IconName; iconClassName: string; bgClassName: string }
> = {
  // ETH/USDnr/USDC glyphs sit on fixed brand-colored tiles, so they stay white
  // regardless of the host's foreground override.
  ETH: { icon: "eth", iconClassName: "size-6 text-white", bgClassName: "bg-[#627EEA]" },
  USDnr: { icon: "usdnr", iconClassName: "size-6 text-white", bgClassName: "bg-[#7f52d0]" },
  USDC: { icon: "usdc", iconClassName: "size-6 text-white", bgClassName: "bg-[#2775CA]" },
  BLEND: { icon: "fluent", iconClassName: "size-4", bgClassName: "bg-[#FFFFFF]/10" },
};
