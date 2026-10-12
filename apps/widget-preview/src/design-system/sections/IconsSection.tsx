import { Icon, type IconName } from "@fluent.xyz/connect";
import { VISUAL_BY_DEFAULT_SYMBOL } from "@fluent.xyz/connect/internal/components/tokenVisuals";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleCheck,
  CircleHelp,
  Copy,
  ExternalLink,
  Info,
  KeyRound,
  Layers,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  OctagonX,
  Plus,
  RefreshCw,
  RotateCw,
  Send,
  Settings,
  Trash2,
  TriangleAlert,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import { Section, Specimen, SpecimenGrid } from "../Specimen";

// `satisfies` makes a name added to or dropped from `IconName` fail typecheck
// here, so the grid cannot silently fall behind the set.
const ICON_NAME_SET = {
  fluent: true,
  fluentLogomark: true,
  fluentLogotype: true,
  x: true,
  google: true,
  coinbase: true,
  walletConnect: true,
  metaMask: true,
  rabby: true,
  keplr: true,
  okx: true,
  "arrow-right-s-line": true,
  "arrow-left-right-line": true,
  "arrow-up-line": true,
  "arrow-up-s-fill": true,
  "arrow-down-s-fill": true,
  plus: true,
  eth: true,
  usdnr: true,
  usdc: true,
  blend: true,
} satisfies Record<IconName, true>;

const ICON_NAMES = Object.keys(ICON_NAME_SET) as IconName[];

const LUCIDE: Array<[string, LucideIcon]> = [
  ["AlertTriangle", AlertTriangle],
  ["Check", Check],
  ["ChevronDown", ChevronDown],
  ["ChevronLeft", ChevronLeft],
  ["ChevronUp", ChevronUp],
  ["CircleCheck", CircleCheck],
  ["CircleHelp", CircleHelp],
  ["Copy", Copy],
  ["ExternalLink", ExternalLink],
  ["Info", Info],
  ["KeyRound", KeyRound],
  ["Layers", Layers],
  ["Loader2", Loader2],
  ["LogIn", LogIn],
  ["LogOut", LogOut],
  ["Mail", Mail],
  ["OctagonX", OctagonX],
  ["Plus", Plus],
  ["RefreshCw", RefreshCw],
  ["RotateCw", RotateCw],
  ["Send", Send],
  ["Settings", Settings],
  ["Trash2", Trash2],
  ["TriangleAlert", TriangleAlert],
  ["Wallet", Wallet],
  ["X", X],
];

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex size-12 items-center justify-center rounded-xl bg-foreground/5 ring-1 ring-foreground/10">
        {children}
      </div>
      <code className="max-w-16 truncate text-[10px] text-muted-foreground" title={label}>
        {label}
      </code>
    </div>
  );
}

export function IconsSection() {
  return (
    <Section
      id="icons"
      title="Icons"
      note={
        <>
          Brand and token glyphs are inline SVGs in <code>Icon.tsx</code>; everything else is
          Lucide. Token glyphs sit on the tiles <code>tokenVisuals.ts</code> assigns them.
        </>
      }
    >
      <SpecimenGrid>
        <Specimen title="Icon — every IconName" note="Rendered at size-6; the logotype keeps its aspect." status="tokens" wide>
          <div className="flex flex-wrap gap-3">
            {ICON_NAMES.map((name) => (
              <Tile key={name} label={name}>
                <Icon name={name} className={name === "fluentLogotype" ? "h-4 w-auto" : "size-6"} />
              </Tile>
            ))}
          </div>
        </Specimen>
        <Specimen title="Token tiles" note="The glyph, size and tile per default token. Brand colours are literal on purpose, so they survive a foreground override." status="tokens">
          <div className="flex flex-wrap gap-3">
            {Object.entries(VISUAL_BY_DEFAULT_SYMBOL).map(([symbol, visual]) => (
              <div key={symbol} className="flex flex-col items-center gap-1.5">
                <span className={`flex size-10 items-center justify-center rounded-full ${visual.bgClassName}`}>
                  <Icon name={visual.icon} className={visual.iconClassName} />
                </span>
                <code className="text-[10px] text-muted-foreground">{symbol}</code>
              </div>
            ))}
            <div className="flex flex-col items-center gap-1.5">
              <span className="flex size-10 items-center justify-center rounded-full bg-foreground/10 text-lg font-medium">
                P
              </span>
              <code className="text-[10px] text-muted-foreground">unknown</code>
            </div>
          </div>
        </Specimen>
        <Specimen title="Lucide — in use" note="The set the widget imports today." status="tokens" wide>
          <div className="flex flex-wrap gap-3">
            {LUCIDE.map(([name, Glyph]) => (
              <Tile key={name} label={name}>
                <Glyph className="size-5" />
              </Tile>
            ))}
          </div>
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}
