import * as React from "react";
import {
  ChevronLeft,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  RotateCw,
  Send,
  Wallet,
  X,
} from "lucide-react";

import { cn } from "../lib/utils";
import type { FluentWalletChoice } from "../core/types";
import { Icon } from "./Icon";
import { buttonVariants } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";

/*
 * The connect dialog's presentational pieces: the popup chrome both connect
 * modals share, and the screens the direct-login flow steps through. Nothing
 * here touches Privy — `InlineConnectModal` holds that state machine and
 * composes these, and the widget preview renders them on their own.
 */

/** The brand glow behind every connect dialog. */
export const CONNECT_DIALOG_GRADIENT =
  "radial-gradient(152.48% 152.48% at 50% 84.8%, #000 25.21%, #5011FF 53.1%)";

export function ConnectDialogBackdrop() {
  return (
    <div
      className="absolute inset-1.5 z-[1] rounded-[18px]"
      style={{
        background: CONNECT_DIALOG_GRADIENT,
        backgroundSize: "150% auto",
        backgroundPosition: "center center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

export type ConnectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element focused when the dialog opens; the inline modal passes its heading. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Extra classes for the popup. */
  className?: string;
  /** Rendered above the backdrop, so content wants `z-20` or higher. */
  children: React.ReactNode;
};

/** The chrome both connect modals share: the popup, dark and clipped, over the brand glow. */
export function ConnectDialog({
  open,
  onOpenChange,
  initialFocus,
  className,
  children,
}: ConnectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        initialFocus={initialFocus}
        className={cn("dark overflow-hidden text-white antialiased", className)}
      >
        {children}
        <ConnectDialogBackdrop />
      </DialogContent>
    </Dialog>
  );
}

/** The scroll viewport of the direct-login flow; its clip edge meets the popup edge. */
export function ConnectDialogViewport({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-20 -m-4 min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-4">
      {children}
    </div>
  );
}

export type ConnectScreenName =
  | "choice"
  | "wallet"
  | "email"
  | "code"
  | "oauth"
  | "connecting";

export type ConnectScreenProps = {
  screen: ConnectScreenName;
  title: React.ReactNode;
  description: React.ReactNode;
  /** Sits above the title; the waits show a spinner here. */
  headerIcon?: React.ReactNode;
  /** The one alert line a screen shows. */
  error?: string;
  /** The focusable wrapper around the title. */
  headingRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
  /** After the alert line. */
  footer?: React.ReactNode;
};

/**
 * One screen of the direct-login flow. The caller keys it by `screen` so a change
 * of screen replays the entrance animation.
 */
export function ConnectScreen({
  screen,
  title,
  description,
  headerIcon,
  error,
  headingRef,
  children,
  footer,
}: ConnectScreenProps) {
  return (
    <div
      data-auth-screen={screen}
      className="flex flex-col animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
    >
      <DialogHeader className="items-center px-4 pt-5 pb-3 text-center">
        {headerIcon}
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          <DialogTitle>{title}</DialogTitle>
        </div>
        <DialogDescription className="break-words text-balance">
          {description}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2 p-2.5">
        {children}
        {error && (
          <p className="px-2.5 text-xs text-[#ff8fda]" role="alert">
            {error}
          </p>
        )}
        {footer}
      </div>
    </div>
  );
}

/** The brand lockup the choice screen shows in place of a heading; the text stays for assistive tech. */
export function ConnectBrandTitle({ children = "Sign in" }: { children?: string }) {
  return (
    <span className="my-3 flex items-center justify-center gap-1.5">
      <Icon name="fluentLogomark" className="h-5 w-auto" />
      <Icon name="fluentLogotype" className="h-5 w-auto" />
      <span className="sr-only">{children}</span>
    </span>
  );
}

const buttonIcons = {
  x: (props: React.SVGProps<SVGSVGElement>) => <Icon {...props} name="x" />,
  google: (props: React.SVGProps<SVGSVGElement>) => (
    <Icon {...props} name="google" />
  ),
  wallet: Wallet,
  email: Mail,
  passkey: KeyRound,
  back: ChevronLeft,
  retry: RotateCw,
  send: Send,
  signIn: LogIn,
  close: X,
  spinner: Loader2,
};

export type ConnectButtonIcon = keyof typeof buttonIcons;

function ConnectButtonGlyph({ name }: { name?: ConnectButtonIcon }) {
  if (!name) return null;
  const Svg = buttonIcons[name];
  return (
    <Svg
      className={cn(
        "size-4 shrink-0",
        name === "spinner" && "animate-spin motion-reduce:animate-none",
      )}
      aria-hidden={true}
      focusable={false}
    />
  );
}

export type ConnectButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** The button's only text, which is what tests and assistive tech read. */
  label: string;
  icon?: ConnectButtonIcon;
  primary?: boolean;
  link?: boolean;
};

/**
 * A native button styled with the shared variants: the same look as `Button`,
 * without Base UI's hooks, which the test renderer cannot host.
 */
export function ConnectButton({
  label,
  icon,
  primary = false,
  link = false,
  className,
  type = "button",
  ...rest
}: ConnectButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        buttonVariants({
          variant: primary ? "default" : link ? "link" : "secondary",
        }),
        link ? "self-center text-white/50 hover:text-white/80" : "w-full",
        className,
      )}
      {...rest}
    >
      <ConnectButtonGlyph name={icon} />
      {label}
    </button>
  );
}

export type ConnectWalletListProps = {
  choices?: readonly FluentWalletChoice[];
  disabled: boolean;
  onChoose: (choice: FluentWalletChoice) => void;
  listRef?: React.Ref<HTMLDivElement>;
};

/** The expanded "Other wallets" list, one button per wallet the host can connect. */
export function ConnectWalletList({
  choices,
  disabled,
  onChoose,
  listRef,
}: ConnectWalletListProps) {
  return (
    <div
      className="flex flex-col gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
      ref={listRef}
      role="group"
      aria-label="Other wallets"
    >
      {choices?.length ? (
        choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={cn(buttonVariants({ variant: "secondary" }), "w-full")}
            disabled={disabled}
            onClick={() => onChoose(choice)}
          >
            {choice.icon ? (
              <img
                className="size-4 shrink-0 rounded-sm object-contain"
                src={choice.icon}
                alt=""
              />
            ) : (
              <ConnectButtonGlyph name="wallet" />
            )}
            {choice.name}
          </button>
        ))
      ) : (
        <p className="px-2.5 text-center text-sm text-muted-foreground">
          {"No wallet connections available."}
        </p>
      )}
    </div>
  );
}

export type ConnectEmailFormProps = {
  /** Code entry rather than the email address. */
  verifying: boolean;
  value: string;
  onChange: (value: string) => void;
  /** Called after the submit event is cancelled; the caller validates. */
  onSubmit: () => void;
  /** Holds the input; the submit too unless `submitDisabled` says otherwise. */
  disabled: boolean;
  submitDisabled?: boolean;
  submitLabel: string;
  submitIcon: ConnectButtonIcon;
  inputRef?: React.Ref<HTMLInputElement>;
};

/** The email and code screens' form: one labelled input and the primary submit. */
export function ConnectEmailForm({
  verifying,
  value,
  onChange,
  onSubmit,
  disabled,
  submitDisabled = disabled,
  submitLabel,
  submitIcon,
  inputRef,
}: ConnectEmailFormProps) {
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Label htmlFor="fluent-inline-input" className="text-white/70">
        {verifying ? "Verification code" : "Email address"}
      </Label>
      <input
        ref={inputRef}
        id="fluent-inline-input"
        className="h-10 w-full rounded-xl bg-black/30 px-3 text-base text-white ring-1 ring-foreground/10 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-foreground/30 disabled:opacity-50 sm:text-sm"
        type={verifying ? "text" : "email"}
        autoComplete={verifying ? "one-time-code" : "email"}
        inputMode={verifying ? "numeric" : "email"}
        maxLength={verifying ? 6 : 254}
        required={true}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <ConnectButton
        label={submitLabel}
        icon={submitIcon}
        primary
        type="submit"
        disabled={submitDisabled}
      />
    </form>
  );
}

/** The spinner a waiting screen shows above its title. */
export function ConnectSpinner({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <Loader2
      className={cn(
        "mx-auto size-6 animate-spin text-white/80 motion-reduce:animate-none",
        className,
      )}
      role="status"
      aria-label={label}
    />
  );
}
