import { Icon } from "./Icon";

export type FluentWidgetConnectButtonProps = {
  connected: boolean;
  addressLabel?: string;
  onClick: () => void;
  className?: string;
};

/** Default Fluent Connect / account button — place it anywhere in your layout. */
export function FluentWidgetConnectButton({
  connected,
  addressLabel,
  onClick,
  className,
}: FluentWidgetConnectButtonProps) {
  return (
    <button
      type="button"
      className={
        className ??
        "bg-black p-1.5 pr-3 rounded-xl flex items-center gap-2 text-white shadow-2xl overflow-hidden relative group"
      }
      aria-expanded={connected || undefined}
      onClick={onClick}
    >
      <div className="size-9 p-3 bg-white/5 rounded-md flex items-center justify-center relative z-10 ">
        <Icon name="fluent" className="w-full " />
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
          <div className="text-[10px] leading-none text-white/50">Wallet</div>
          <div className="text-sm font-medium leading-none">
            {addressLabel ?? "Connected"}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-0.5 relative z-10">
          <div className="text-sm font-medium leading-none">Connect Wallet</div>
          <div className="text-[10px] leading-none text-white/50">Powered by Fluent</div>
        </div>
      )}
    </button>
  );
}
