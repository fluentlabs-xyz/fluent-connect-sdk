import { Loader2 } from "lucide-react";

import { Icon } from "./Icon";

export type FluentWidgetConnectButtonProps = {
  connected: boolean;
  /** Preparing the account after sign-in — disables the button and shows a spinner. */
  pending?: boolean;
  addressLabel?: string;
  onClick: () => void;
  className?: string;
  userLogoUrl?: string | null;
};

/** Default Fluent Connect / account button — place it anywhere in your layout. */
export function FluentWidgetConnectButton({
  connected,
  pending = false,
  addressLabel,
  onClick,
  className,
  userLogoUrl,
}: FluentWidgetConnectButtonProps) {
  const userLogo = userLogoUrl ? (
    <img src={userLogoUrl} alt="User logo" className="rounded-md" />
  ) : (
    <Icon name="fluent" className="size-3" />
  );

  return (
    <button
      type="button"
      className={
        className ??
        "bg-black p-1.5 pr-3 rounded-xl flex items-center gap-2 text-white overflow-hidden relative group"
      }
      aria-expanded={connected || undefined}
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={onClick}
    >
      <div className="size-8 bg-white/5 rounded-md flex items-center justify-center relative z-10 ">
        {pending ? (
          <Loader2 className="w-full animate-spin" />
        ) : (
          userLogo
        )}
      </div>

      <div
        className="absolute z-[1] inset-0 h-[200%] opacity-25 group-hover:opacity-50 transition-all duration-250 ease-in-out -translate-y-0 group-hover:-translate-y-5 group-hover:h-[300%]"
        style={{
          background:
            "radial-gradient(152.48% 152.48% at 50% 84.8%, #000 25.21%, #5011FF 53.1%)",
          backgroundSize: "150% auto",
          backgroundPosition: "center center",
          backgroundRepeat: "no-repeat",
        }}
      />

      {connected ? (
        <div className="flex flex-col items-start gap-0.5 relative z-10">
          <div className="text-sm font-medium leading-none">
            {addressLabel ?? "Connected"}
          </div>
        </div>
      ) : pending ? (
        <div className="flex flex-col items-start gap-0.5 relative z-10">
          <div className="text-sm font-medium leading-none">Connecting…</div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-0.5 relative z-10">
          <div className="text-sm font-medium leading-none">Connect Wallet</div>
        </div>
      )}
    </button>
  );
}
