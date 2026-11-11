import { cn } from "../lib/utils";

/**
 * Returns the dialog's lead line, under the brand lockup: what the Fluent methods do (log in,
 * or sign up) and for which App, by its `appName`, or "this app" without one.
 */
export function connectDescription(appName?: string) {
  return `Log in or sign up to ${appName?.trim() || "this app"}`;
}

const termsOfUseUrl = "https://cdn.fluent.xyz/docs/fluent-connect-sdk-terms-of-use.pdf";
const privacyPolicyUrl = "https://cdn.fluent.xyz/docs/fluent-connect-sdk-privacy-policy.pdf";

/*
 * The colour and underline are `!` because an App's own `a` rule is unlayered and so beats
 * any utility in this package's layers, whatever its specificity. See `ui/button.tsx`. The
 * colour comes from `--link` / `--link-hover` (`theme.css`), so an App restyles these links
 * through the theme rather than through `a`.
 */
function ConsentLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="whitespace-nowrap text-(--link)! underline! underline-offset-2 hover:text-(--link-hover)!"
    >
      {children}
    </a>
  );
}

/**
 * The connect dialog's panel for the Fluent methods: a lit panel whose surface and edge fade out
 * by 70% of its height, labelled "Recommended" by a glass badge astride its top edge, over one
 * benefits line shared by all of them and a quieter consent line. The wallet row sits off the
 * panel, past a `BranchDivider`.
 */
export function FluentBranch({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // The edge is a 1px gradient ring drawn by ::before, cut out of its own padding box, with
        // a gap in its top run for the badge: its width plus 8px a side. Rounded at the top only:
        // surface and edge fade out by 70% of the height, so the panel has no bottom edge.
        "relative mt-3 flex flex-col gap-2 rounded-t-2xl bg-[linear-gradient(to_bottom,rgba(255,255,255,0.08),transparent_70%)] px-5 pt-5 pb-2",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-t-2xl before:p-px before:bg-[linear-gradient(to_bottom,rgba(255,255,255,0.2),transparent_70%)]",
        "before:[mask:linear-gradient(to_right,#000_calc(50%-60px),transparent_calc(50%-60px)_calc(50%+60px),#000_calc(50%+60px))_intersect,linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]",
        className,
      )}
    >
      {/* Frosted glass astride the top edge. A fixed width keeps the edge's gap in step with it. */}
      <span className="absolute top-0 left-1/2 w-26 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 py-0.5 text-center text-[10px] font-medium uppercase leading-4 tracking-wider text-white ring-1 ring-inset ring-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-md">
        Recommended
      </span>
      {children}
      <div className="flex flex-col gap-0.5 pt-0.5 text-center text-[11px] leading-4">
        <p className="text-white/60">Gasless transactions and faster signing.</p>
        <p className="-mx-5 text-balance text-[10px] text-white/40">
          By continuing, you agree to our{" "}
          <ConsentLink href={termsOfUseUrl}>Terms of Use</ConsentLink> and{" "}
          <ConsentLink href={privacyPolicyUrl}>Privacy Policy</ConsentLink>.
        </p>
      </div>
    </div>
  );
}

/** The hairline between the Fluent panel and the wallet row, fading out at both ends. */
export function BranchDivider() {
  return (
    <div
      className="my-1 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
      aria-hidden
    />
  );
}

/** The classes of the wallet row: `Button`'s secondary variant, one step quieter. */
export const walletRowClassName =
  "bg-transparent text-white/85 ring-1 ring-inset ring-white/10 hover:bg-white/5 hover:text-white";

export function WalletBranchNote() {
  return (
    <p className="text-center text-[11px] leading-4 text-white/45">
      Manual signing required. Gas fees may apply.
    </p>
  );
}
