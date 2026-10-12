import { cn } from "../lib/utils";

// The document fluent.xyz links from its footer; the site has no stable
// /privacy route yet, so this moves whenever the PDF is re-uploaded.
/** The dialog's lead line: the app being signed into, by the host's name for it. */
export function connectDescription(appName?: string) {
  return `Use Fluent Connect to access ${appName?.trim() || "this app"}.`;
}

const privacyPolicyUrl =
  "https://cdn.prod.website-files.com/67ae0a445cb83ac7024dc85a/69bd38dc078b1bd9bb296af3_Fluent%20Foundation%20-%20Privacy%20Policy%20%5BDRAFT%5D.docx.pdf";

/**
 * The two arms of the connect funnel, told apart at a glance: the Fluent
 * methods carry a note saying what signing in creates; an "or" rule separates
 * them from the external-wallet row, whose note says what that path gives up.
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
      {children}
      <p className="px-2.5 text-center text-[10px] leading-snug text-white/50">
        Gasless, one-tap signing. By continuing you agree to our{" "}
        <a
          href={privacyPolicyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-white/70 underline underline-offset-2 hover:text-white"
        >
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}

export function OrDivider() {
  return (
    <div
      className="flex items-center gap-3 px-1 py-2 text-[11px] font-medium uppercase tracking-wide text-white/40"
      aria-hidden
    >
      <span className="h-px flex-1 bg-white/10" />
      or
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

export function WalletBranchNote() {
  return (
    <p className="px-2.5 text-center text-[10px] leading-snug text-white/50">
      Existing wallet. Manual signing, gas fees may apply.
    </p>
  );
}
