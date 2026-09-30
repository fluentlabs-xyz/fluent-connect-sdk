import * as React from "react";
import {
  Captcha,
  useCreateWallet,
  useLoginWithEmail,
  useLoginWithOAuth,
  useLoginWithPasskey,
  useModalStatus,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
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
import { buttonVariants } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Icon } from "./Icon";
import type { ConnectChoiceModalProps } from "./ConnectChoiceModal";
import {
  clearInlineOAuth,
  getPendingInlineOAuth,
  hasPendingInlineOAuth,
  inlineOAuthKey,
  type InlineOAuthProvider,
} from "../utils/inlineOAuth";
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
type Step = "choice" | "login" | "email" | "code" | "oauth" | "connecting";
type ButtonOptions = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: keyof typeof buttonIcons;
  primary?: boolean;
  link?: boolean;
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not sign in. Please try again.";
export function InlineConnectModal(props: ConnectChoiceModalProps) {
  const {
    open,
    onClose,
    onFluentLogin,
    onRetry,
    hostedError,
    wallet,
    track,
    onExternalWalletSelected,
  } = props;
  const { ready, authenticated, user } = usePrivy();
  const { isOpen: securityPromptOpen } = useModalStatus();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  // Always mounted, including on the OAuth return URL: this hook finishes login.
  const { initOAuth, state: oauthState } = useLoginWithOAuth();
  const { loginWithPasskey } = useLoginWithPasskey();
  const [step, setStep] = React.useState<Step>(() =>
    hasPendingInlineOAuth() ? "oauth" : "choice",
  );
  const [oauthProvider, setOAuthProvider] = React.useState<InlineOAuthProvider>(
    () => getPendingInlineOAuth()?.provider ?? "twitter",
  );
  const oauthName = oauthProvider === "google" ? "Google" : "X";
  const [showWallets, setShowWallets] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [captchaError, setCaptchaError] = React.useState("");
  const [captchaEpoch, setCaptchaEpoch] = React.useState(0);
  const [resendSeconds, setResendSeconds] = React.useState(0);
  const [walletAttempt, setWalletAttempt] = React.useState(0);
  const [slow, setSlow] = React.useState(false);
  const operation = React.useRef<object | null>(null);
  const generation = React.useRef(0);
  const attemptedWallet = React.useRef<string | null>(null);
  const walletFailed = React.useRef(false);
  const heading = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const walletList = React.useRef<HTMLDivElement>(null);
  const active = React.useRef(open);
  active.current = open;
  const connecting = step !== "choice" && authenticated;
  const screen = connecting ? "connecting" : step;
  const shownError = error || captchaError || (connecting ? hostedError : "");
  React.useEffect(() => {
    if (!open) {
      generation.current++;
      setStep("choice");
      setShowWallets(false);
      setEmail("");
      setCode("");
      setError("");
      setCaptchaError("");
      setBusy(false);
      setSlow(false);
      clearInlineOAuth();
    }
    return () => {
      generation.current++;
    };
  }, [open]);
  React.useEffect(() => {
    if (open) (input.current ?? heading.current)?.focus();
  }, [open, screen]);
  React.useEffect(() => {
    if (open && screen === "choice" && showWallets) {
      walletList.current?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [open, screen, showWallets]);
  React.useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(
      () => setResendSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [resendSeconds]);
  React.useEffect(() => {
    if (oauthState?.status !== "error" || step !== "oauth") return;
    clearInlineOAuth();
    setBusy(false);
    setStep("login");
    setError(message(oauthState.error));
  }, [oauthState, step]);
  React.useEffect(() => {
    if (!open || (!connecting && step !== "oauth")) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(timer);
  }, [open, connecting, step, walletAttempt]);
  React.useEffect(() => {
    if (!open || !connecting || !walletsReady || !user?.id) return;
    clearInlineOAuth();
    const embedded = (account: {
      walletClientType?: string;
      chainType?: string;
    }) =>
      account.walletClientType === "privy" &&
      (!account.chainType || account.chainType === "ethereum");
    if (
      wallets.some(embedded) ||
      user.linkedAccounts?.some(
        (account) => account.type === "wallet" && embedded(account),
      )
    )
      return;
    // Headless login does not run Privy's createOnLogin behavior. Create once
    // per user; hydration/rerenders must never create duplicate wallets.
    if (attemptedWallet.current === user.id) return;
    attemptedWallet.current = user.id;
    walletFailed.current = false;
    const current = generation.current;
    void createWallet().catch((failure) => {
      if (attemptedWallet.current === user.id) walletFailed.current = true;
      if (active.current && current === generation.current)
        setError(message(failure));
    });
  }, [
    open,
    connecting,
    walletsReady,
    wallets,
    user,
    createWallet,
    walletAttempt,
  ]);
  const run = async (
    action: (isCurrent: () => boolean) => Promise<unknown>,
    needsPrivy = true,
  ) => {
    if (operation.current || (needsPrivy && !ready)) return;
    const token = {};
    const current = generation.current;
    operation.current = token;
    setBusy(true);
    setError("");
    try {
      await action(() => active.current && current === generation.current);
    } catch (failure) {
      if (active.current && current === generation.current)
        setError(message(failure));
    } finally {
      if (operation.current === token) operation.current = null;
      if (active.current && current === generation.current) setBusy(false);
    }
  };
  const close = () => {
    generation.current++;
    clearInlineOAuth();
    onClose();
  };
  const go = (next: Step) => {
    setError("");
    setCode("");
    setStep(next);
  };
  const icon = (name?: keyof typeof buttonIcons) => {
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
  };
  // Native buttons styled with the shared variants: the same look as `Button`,
  // without Base UI's hooks, which the test renderer cannot host.
  const button = (
    label: string,
    onClick?: React.MouseEventHandler<HTMLButtonElement>,
    {
      icon: iconName,
      primary = false,
      link = false,
      disabled = busy || !ready,
      className,
      ...rest
    }: ButtonOptions = {},
  ) => (
    <button
      type="button"
      className={cn(
        buttonVariants({
          variant: primary ? "default" : link ? "link" : "secondary",
        }),
        link ? "self-center text-white/50 hover:text-white/80" : "w-full",
        className,
      )}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {icon(iconName)}
      {label}
    </button>
  );
  const progress = (text: string) => (
    <div
      className="flex items-center justify-center gap-2 py-3 text-sm text-white/70"
      role="status"
    >
      <Loader2
        className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden={true}
      />
      {text}
    </div>
  );
  const send = () =>
    run(async (current) => {
      await sendCode({
        email: email.trim(),
      });
      if (current()) {
        setCode("");
        setResendSeconds(30);
        setStep("code");
      }
    });
  const passkey = () =>
    run(async (current) => {
      await loginWithPasskey();
      if (current()) setStep("connecting");
    });
  const oauth = (provider: InlineOAuthProvider) =>
    run(async (current) => {
      // This SDK version redirects for OAuth. Save only a short-lived UI marker.
      window.sessionStorage.setItem(
        inlineOAuthKey,
        JSON.stringify({ started: Date.now(), provider }),
      );
      setOAuthProvider(provider);
      setStep("oauth");
      try {
        await initOAuth({
          provider,
        });
      } catch (failure) {
        clearInlineOAuth();
        if (current()) setStep("login");
        throw failure;
      }
    });
  const retry = () => {
    setError("");
    setSlow(false);
    if (walletFailed.current) attemptedWallet.current = null;
    setWalletAttempt((value) => value + 1);
    onRetry?.();
  };
  let title = "Connect Wallet";
  let description =
    "Sign in with Fluent Connect to access your reputation, positions, and rewards across apps.";
  let content: React.ReactNode;
  if (screen === "choice") {
    content = (
      <React.Fragment>
        <div className="flex flex-col">
          {button(
            "Continue with Fluent Connect",
            () => {
              track("connect_method_selected", {
                method: "fluent",
              });
              setStep("login");
              onFluentLogin();
            },
            {
              primary: true,
            },
          )}
        </div>
        {/* The link gives way to the list: once expanded it stays open until the dialog closes. */}
        {showWallets ? (
          <div
            className="flex flex-col gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
            ref={walletList}
            role="group"
            aria-label="Other wallets"
          >
            {wallet?.choices?.length ? (
              wallet.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={cn(
                    buttonVariants({ variant: "secondary" }),
                    "w-full",
                  )}
                  disabled={busy}
                  onClick={() =>
                    run(async (current) => {
                      track("connect_method_selected", {
                        method: "external",
                        wallet: choice.name,
                      });
                      onExternalWalletSelected();
                      // Only a wallet selection can request authorization. Expanding
                      // this list never opens AppKit or calls a wallet provider.
                      if (choice.handoff) close();
                      await wallet?.connectChoice?.(choice.id);
                      if (current()) close();
                    }, false)
                  }
                >
                  {choice.icon ? (
                    <img
                      className="size-4 shrink-0 rounded-sm object-contain"
                      src={choice.icon}
                      alt=""
                    />
                  ) : (
                    icon("wallet")
                  )}
                  {choice.name}
                </button>
              ))
            ) : (
              <p className="px-2.5 text-center text-sm text-muted-foreground">
                {"No wallet connections available."}
              </p>
            )}
            {busy && progress("Confirm in your wallet…")}
          </div>
        ) : (
          <div className="flex justify-center">
            {button(
              "Other wallets",
              () => {
                if (!wallet?.connectChoice || !wallet.choices) {
                  track("connect_method_selected", {
                    method: "external",
                  });
                  onExternalWalletSelected();
                  wallet?.open();
                  close();
                  return;
                }
                setShowWallets(true);
              },
              {
                link: true,
                disabled: busy || !wallet?.configured,
              },
            )}
          </div>
        )}
      </React.Fragment>
    );
  } else if (screen === "login") {
    title = "Sign in to Fluent";
    description = "Your account, across Fluent apps.";
    content = (
      <React.Fragment>
        {button("Continue with X", () => oauth("twitter"), {
          icon: "x",
          primary: true,
        })}
        {button("Continue with Google", () => oauth("google"), {
          icon: "google",
        })}
        {button("Continue with email", () => go("email"), {
          icon: "email",
        })}
        {button(busy ? "Signing in…" : "Continue with passkey", passkey, {
          icon: busy ? "spinner" : "passkey",
        })}
        {button("Back", () => go("choice"), {
          icon: "back",
          link: true,
        })}
      </React.Fragment>
    );
  } else if (screen === "email" || screen === "code") {
    const verifying = screen === "code";
    title = verifying ? "Check your email" : "Sign in with email";
    description = verifying
      ? `Enter the code sent to ${email.trim()}.`
      : "We’ll send you a sign-in code.";
    content = (
      <React.Fragment>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (verifying) {
              if (!/^\d{6}$/.test(code)) {
                setError("Enter the 6-digit code.");
                return;
              }
              void run(async (current) => {
                await loginWithCode({
                  code,
                });
                if (current()) setStep("connecting");
              });
            } else if (email.trim()) {
              void send();
            }
          }}
        >
          <Label htmlFor="fluent-inline-input" className="text-white/70">
            {verifying ? "Verification code" : "Email address"}
          </Label>
          <input
            ref={input}
            id="fluent-inline-input"
            className="h-10 w-full rounded-xl bg-black/30 px-3 text-base text-white ring-1 ring-foreground/10 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-foreground/30 disabled:opacity-50 sm:text-sm"
            type={verifying ? "text" : "email"}
            autoComplete={verifying ? "one-time-code" : "email"}
            inputMode={verifying ? "numeric" : "email"}
            maxLength={verifying ? 6 : 254}
            required={true}
            disabled={busy}
            value={verifying ? code : email}
            onChange={(event) =>
              verifying
                ? setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                : setEmail(event.target.value)
            }
          />
          {button(
            busy
              ? verifying
                ? "Signing in…"
                : "Sending code…"
              : verifying
                ? "Sign in"
                : "Send code",
            undefined,
            {
              icon: busy ? "spinner" : verifying ? "signIn" : "send",
              primary: true,
              type: "submit",
            },
          )}
        </form>
        {verifying &&
          button(
            resendSeconds ? `Resend code in ${resendSeconds}s` : "Resend code",
            send,
            {
              icon: "retry",
              link: true,
              disabled: busy || resendSeconds > 0,
            },
          )}
        {button(
          verifying ? "Change email" : "Back",
          () => go(verifying ? "email" : "login"),
          {
            icon: verifying ? "email" : "back",
            link: true,
          },
        )}
      </React.Fragment>
    );
  } else {
    title =
      screen === "oauth"
        ? `Continue with ${oauthName}`
        : "Connecting to Fluent";
    description =
      screen === "oauth"
        ? `Complete sign-in with ${oauthName} to return here.`
        : "Preparing your account.";
    content = (
      <React.Fragment>
        {!shownError &&
          progress(slow ? "Taking longer than usual…" : "Connecting…")}
        {(shownError || slow) &&
          button(
            "Try again",
            screen === "oauth"
              ? () => {
                  clearInlineOAuth();
                  go("login");
                }
              : retry,
            {
              icon: "retry",
              disabled: false,
            },
          )}
        {button("Cancel", close, {
          icon: "close",
          link: true,
          disabled: false,
        })}
      </React.Fragment>
    );
  }
  return (
    <Dialog
      open={open && !securityPromptOpen}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        initialFocus={heading}
        className="dark flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden text-white antialiased"
      >
        {/* The scroll viewport sits above the gradient; its clip edge meets the popup edge. */}
        <div className="relative z-20 -m-4 min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-4">
          <div
            key={screen}
            data-auth-screen={screen}
            className="flex flex-col animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
          >
            <DialogHeader className="items-center px-4 pt-5 pb-3 text-center">
              <div ref={heading} tabIndex={-1} className="outline-none">
                <DialogTitle>{title}</DialogTitle>
              </div>
              <DialogDescription className="break-words">
                {description}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 p-2.5">
              {content}
              {shownError && (
                <p className="px-2.5 text-xs text-[#ff8fda]" role="alert">
                  {shownError}
                </p>
              )}
              {captchaError &&
                button(
                  "Retry verification",
                  () => {
                    setCaptchaError("");
                    setCaptchaEpoch((value) => value + 1);
                  },
                  {
                    icon: "retry",
                    disabled: false,
                    link: true,
                  },
                )}
            </div>
          </div>
          {
            // One captcha instance per login attempt, outside the animated screens.
            open && !authenticated && (
              <Captcha
                key={captchaEpoch}
                onError={() =>
                  setCaptchaError("Verification could not load. Please retry.")
                }
                onUnsupported={() =>
                  setCaptchaError(
                    "Verification is unavailable in this browser.",
                  )
                }
                onSuccess={() => setCaptchaError("")}
              />
            )
          }
        </div>
        <div
          className="absolute inset-1.5 z-[1] rounded-[18px]"
          style={{
            background:
              "radial-gradient(152.48% 152.48% at 50% 84.8%, #000 25.21%, #5011FF 53.1%)",
            backgroundSize: "150% auto",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
