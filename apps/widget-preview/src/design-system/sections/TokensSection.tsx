import { useLayoutEffect, useRef, useState } from "react";

import { Section, Specimen, SpecimenGrid } from "../Specimen";

/** The tokens the widget's components actually read, in `theme.css` order. */
const COLOR_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--brand",
  "--button",
  "--button-hover",
  "--button-foreground",
  "--tabs",
  "--tabs-foreground",
  "--tabs-active",
  "--tabs-active-foreground",
];

/** A box painted with one token; the declared value is read back from the box. */
function Swatch({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");

  useLayoutEffect(() => {
    if (ref.current) setValue(getComputedStyle(ref.current).getPropertyValue(name).trim());
  }, [name]);

  return (
    <div className="flex items-center gap-3">
      <div
        ref={ref}
        className="size-9 shrink-0 rounded-lg ring-1 ring-foreground/15"
        style={{ background: `var(${name})` }}
      />
      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={value}>
        {value || "—"}
      </span>
    </div>
  );
}

/** The token list in one colour scheme; the scope class decides which. */
function Palette({ scope }: { scope: "fluent-root" | "fluent-root dark" }) {
  return (
    <div className={`${scope} flex flex-col gap-2 rounded-xl bg-background p-4 text-foreground`}>
      {COLOR_TOKENS.map((name) => (
        <div key={name} className="grid grid-cols-[11rem_minmax(0,1fr)] items-center gap-3 text-xs">
          <code className="truncate text-foreground/80">{name}</code>
          <Swatch name={name} />
        </div>
      ))}
    </div>
  );
}

const RADII = [
  { name: "rounded-sm", note: "--radius − 4px" },
  { name: "rounded-md", note: "--radius − 2px" },
  { name: "rounded-lg", note: "--radius" },
  { name: "rounded-xl", note: "--radius + 4px (buttons, rows)" },
  { name: "rounded-2xl", note: "literal (cards, toasts)" },
  { name: "rounded-3xl", note: "literal (dialogs)" },
  { name: "rounded-[18px]", note: "literal (review dialog)" },
];

const TYPE = [
  { className: "text-3xl font-medium tracking-tight", label: "text-3xl / medium" },
  { className: "text-2xl font-medium", label: "text-2xl / medium (review title)" },
  { className: "text-xl font-medium tracking-tight", label: "text-xl / medium" },
  { className: "text-base font-medium", label: "text-base / medium (dialog title)" },
  { className: "text-sm", label: "text-sm (body)" },
  { className: "text-sm text-muted-foreground", label: "text-sm / muted" },
  { className: "text-xs text-muted-foreground", label: "text-xs / muted (descriptions)" },
  { className: "text-[11px] font-medium uppercase tracking-[0.055em] text-muted-foreground", label: "eyebrow" },
  { className: "font-mono text-xs", label: "font-mono / xs (addresses, hashes)" },
];

export function TokensSection() {
  return (
    <Section
      id="tokens"
      title="Tokens"
      note={
        <>
          The CSS variables in <code>packages/connect/src/styles/theme.css</code>, scoped to{" "}
          <code>.fluent-root</code>. The widget only ever renders the dark set; the light set exists
          but nothing switches to it. Values are read from the rendered box, so a host override
          shows up here too.
        </>
      }
    >
      <SpecimenGrid>
        <Specimen title="Colours — dark" note="What the widget ships." status="tokens" padded={false}>
          <Palette scope="fluent-root dark" />
        </Specimen>
        <Specimen title="Colours — light" note="Defined, unused." status="tokens" padded={false}>
          <Palette scope="fluent-root" />
        </Specimen>
        <Specimen title="Radius" note="Four steps off --radius (0.625rem), plus the literals components reach for." status="mixed">
          <div className="flex flex-wrap gap-4">
            {RADII.map((radius) => (
              <div key={radius.name} className="flex flex-col items-start gap-1.5">
                <div className={`size-14 bg-foreground/10 ring-1 ring-foreground/20 ${radius.name}`} />
                <code className="text-[11px]">{radius.name}</code>
                <span className="text-[10px] text-muted-foreground">{radius.note}</span>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen title="Typography" note="System sans; no font is shipped. The sizes the widget uses, with their roles." status="tokens">
          <div className="flex flex-col gap-3">
            {TYPE.map((sample) => (
              <div key={sample.label} className="flex flex-col gap-0.5">
                <span className={sample.className}>The quick brown fox jumps over 0x92b7…b8C7</span>
                <span className="text-[10px] text-muted-foreground/70">{sample.label}</span>
              </div>
            ))}
          </div>
        </Specimen>
      </SpecimenGrid>
    </Section>
  );
}
