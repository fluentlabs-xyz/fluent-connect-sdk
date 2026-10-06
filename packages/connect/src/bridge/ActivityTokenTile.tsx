import { Icon, type IconName } from "../components/Icon";
import { VISUAL_BY_DEFAULT_SYMBOL } from "../components/tokenVisuals";
import type { BridgeHistoryRow } from "./historyRows";

/** The chain a transfer left from, as a glyph on a tile; callers size the glyph. */
export const CHAIN_BADGE: Record<
  BridgeHistoryRow["direction"],
  { icon: IconName; iconClassName: string; bgClassName: string }
> = {
  l1_to_l2: { icon: "eth", iconClassName: "text-white", bgClassName: "bg-[#627EEA]" },
  l2_to_l1: { icon: "fluent", iconClassName: "text-foreground", bgClassName: "bg-muted" },
};

/**
 * A token on a round tile, badged with the chain the row happened on. The
 * glyphs are the token list's, so ETH here is ETH there. Symbols come from the
 * bridge's own token config, the indexer and FluentScan, never a stranger's
 * contract, so the list's `isFluentDefaultToken` gate does not apply.
 *
 * `badge` is keyed like a transfer direction: `l1_to_l2` is Ethereum,
 * `l2_to_l1` is Fluent — the chain a row left from, or simply lives on.
 */
export function ActivityTokenTile({
  tokenSymbol,
  badge: badgeKey,
  className = "size-10",
}: {
  tokenSymbol?: string;
  badge: BridgeHistoryRow["direction"];
  className?: string;
}) {
  const visual = tokenSymbol ? VISUAL_BY_DEFAULT_SYMBOL[tokenSymbol] : undefined;
  const badge = CHAIN_BADGE[badgeKey];

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-full ${visual?.bgClassName ?? "bg-foreground/10"} ${className}`}
    >
      {visual ? (
        <Icon name={visual.icon} className={visual.iconClassName} />
      ) : (
        <span className="text-lg font-medium">{tokenSymbol?.slice(0, 1) ?? "?"}</span>
      )}
      <span
        className={`absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full ring-4 ring-neutral-900 group-hover:ring-neutral-800 ${badge.bgClassName}`}
      >
        <Icon name={badge.icon} className={`size-2.5 ${badge.iconClassName}`} />
      </span>
    </span>
  );
}
