import type { IconName } from "./Icon";

/**
 * How each token Fluent ships is drawn: which glyph, how big, and what tile
 * sits behind it. Looked up by symbol, but only ever for a token that passed
 * `isFluentDefaultToken` first — the symbol comes off a contract, so without
 * that gate anything calling itself BLEND would inherit BLEND's icon and look
 * official.
 */
export const VISUAL_BY_DEFAULT_SYMBOL: Record<
  string,
  { icon: IconName; iconClassName: string; bgClassName: string }
> = {
  // ETH/USDnr glyphs sit on fixed brand-colored tiles, so they stay white
  // regardless of the host's foreground override.
  ETH: { icon: "eth", iconClassName: "size-6 text-white", bgClassName: "bg-[#627EEA]" },
  USDnr: { icon: "usdnr", iconClassName: "size-6 text-white", bgClassName: "bg-[#7f52d0]" },
  BLEND: { icon: "fluent", iconClassName: "size-4", bgClassName: "bg-[#FFFFFF]/10" },
};
