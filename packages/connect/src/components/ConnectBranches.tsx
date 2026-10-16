import { cn } from "../lib/utils";

/**
 * The dialog's lead line, under the brand lockup: what the Fluent
 * methods do (create the account, or get into it) and for which app, by the
 * host's name for it. `via` names the methods on offer, e.g. "X or email";
 * without it the line is method-agnostic.
 */
export function connectDescription(appName?: string, via?: string) {
  const app = appName?.trim() || "this app";
  return via
    ? `Use ${via} to create or access your Fluent Connect account for ${app}.`
    : `Create or access your Fluent Connect account to use ${app}.`;
}

/** "X", "X or email", "X, Google or email" — the methods as the lead line names them. */
export function methodList(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

// The document fluent.xyz links from its footer; the site has no stable
// /privacy route yet, so this moves whenever the PDF is re-uploaded.
const privacyPolicyUrl =
  "https://cdn.prod.website-files.com/67ae0a445cb83ac7024dc85a/69bd38dc078b1bd9bb296af3_Fluent%20Foundation%20-%20Privacy%20Policy%20%5BDRAFT%5D.docx.pdf";

/**
 * The two arms of the connect funnel, told apart at a glance: the Fluent
 * methods sit together under one "Recommended" label pinned to the first of
 * them, over one short benefits line shared by all of them, with the consent
 * line kept quieter beneath; a hairline separates them from the wallet row,
 * whose note says what that path gives up.
 */
export function FluentBranch({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Tighter to the button below it than that button is to the next: the label is the first method's. */}
      <span className="-mb-1 self-start rounded-full bg-[#7c5cff]/60 px-2 py-0.5 text-[10px] font-medium uppercase leading-4 tracking-wider text-white">
        Recommended
      </span>
      {children}
      <div className="flex flex-col gap-0.5 px-2.5 pt-0.5 text-center text-[11px] leading-4">
        <p className="text-white/60">Gasless transactions and faster signing.</p>
        <p className="text-white/40">
          By continuing, you accept our{" "}
          <a
            href={privacyPolicyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap text-white/55 underline underline-offset-2 hover:text-white/80"
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/** The hairline between the Fluent methods and the wallet row. */
export function BranchDivider() {
  return <div className="my-1.5 h-px bg-white/10" aria-hidden />;
}

/** Sits on the wallet row: the same look as `Button`'s secondary variant, one step quieter. */
export const walletRowClassName =
  "bg-transparent text-white/85 ring-1 ring-inset ring-white/10 hover:bg-white/5 hover:text-white";

export function WalletBranchNote() {
  return (
    <p className="px-2.5 text-center text-[11px] leading-4 text-white/45">
      Manual signing required. Gas fees may apply.
    </p>
  );
}
