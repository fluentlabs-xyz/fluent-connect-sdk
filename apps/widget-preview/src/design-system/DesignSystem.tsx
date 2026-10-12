import { FluentPortalContainerProvider } from "@fluent.xyz/connect";
import { Toaster } from "@fluent.xyz/connect/internal/ui/toast";
import { TooltipProvider } from "@fluent.xyz/connect/internal/ui/tooltip";
import { useState } from "react";

import { PreviewNav } from "../PreviewNav";
import { StatusLegend } from "./Specimen";
import { CompositesSection } from "./sections/CompositesSection";
import { DialogsSection, LiveOverlays, type LiveOverlay } from "./sections/DialogsSection";
import { IconsSection } from "./sections/IconsSection";
import { PrimitivesSection } from "./sections/PrimitivesSection";
import { ReviewsStaticSection } from "./sections/ReviewsStaticSection";
import { ScreensSection } from "./sections/ScreensSection";
import { TokensSection } from "./sections/TokensSection";

const SECTIONS = [
  { href: "#tokens", label: "Tokens" },
  { href: "#primitives", label: "Primitives" },
  { href: "#icons", label: "Icons" },
  { href: "#composites", label: "Composite elements" },
  { href: "#screens", label: "Screens" },
  { href: "#dialogs", label: "Dialogs" },
  { href: "#reviews", label: "Review dialogs" },
];

/**
 * Every primitive, composite, screen and dialog of the widget on one page, with
 * fabricated data, so the design system can be reviewed without a login.
 *
 * Two subtrees on purpose: overlays (selects, tooltips, toasts, dialogs, drawers)
 * need `FluentPortalContainerProvider` to land in a styled root, but the review
 * dialogs can only be laid flat where that provider is absent — with it, they
 * portal to the top layer and cover the page.
 */
export default function DesignSystem() {
  const [live, setLive] = useState<LiveOverlay | null>(null);

  return (
    <div className="min-h-screen bg-black font-sans text-white antialiased">
      <div className="mx-auto flex w-full max-w-[1400px] gap-10 px-6 py-14">
        <aside className="sticky top-8 hidden w-48 shrink-0 flex-col gap-6 self-start lg:flex">
          <PreviewNav />
          <nav aria-label="Sections" className="flex flex-col gap-1.5 text-sm">
            {SECTIONS.map((section) => (
              <a key={section.href} href={section.href} className="text-white/50 transition-colors hover:text-white">
                {section.label}
              </a>
            ))}
          </nav>
          <StatusLegend />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-16">
          <header className="flex max-w-[720px] flex-col gap-3">
            <div className="lg:hidden">
              <PreviewNav />
            </div>
            <span className="text-[11px] font-medium uppercase tracking-[0.055em] text-white/40">
              Fluent Widget Preview
            </span>
            <h1 className="text-3xl font-medium tracking-tight">Design system</h1>
            <p className="text-sm leading-relaxed text-white/50">
              Every component the widget ships, rendered from source with fabricated data. Each card
              says how far it has moved onto the theme tokens; the legend on the left explains the
              badges. Nothing here signs in, signs or sends.
            </p>
          </header>

          <FluentPortalContainerProvider>
            <TooltipProvider delay={200}>
              <Toaster>
                <TokensSection />
                <PrimitivesSection />
                <IconsSection />
                <CompositesSection />
                <ScreensSection />
                <DialogsSection onOpen={setLive} />
                <LiveOverlays live={live} onClose={() => setLive(null)} />
              </Toaster>
            </TooltipProvider>
          </FluentPortalContainerProvider>

          <ReviewsStaticSection />
        </main>
      </div>
    </div>
  );
}
