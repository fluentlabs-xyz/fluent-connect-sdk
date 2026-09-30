import * as React from "react";
import {
  Captcha,
  useCreateWallet,
  useLoginWithEmail,
  useLoginWithOAuth,
  useModalStatus,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import {
  ChevronLeft,
  Loader2,
  LogIn,
  Mail,
  RotateCw,
  Send,
  Wallet,
  X,
} from "lucide-react";
import { FLUENT_CONNECT_DEFAULT_ASSETS } from "../core/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Icon } from "./Icon";
import type { ConnectChoiceModalProps } from "./ConnectChoiceModal";
import {
  clearInlineOAuth,
  hasPendingInlineOAuth,
  inlineOAuthKey,
} from "../utils/inlineOAuth";
const h = React.createElement;
const buttonIcons = {
  fluent: (props: React.SVGProps<SVGSVGElement>) => (
    <Icon {...props} name="fluent" />
  ),
  x: (props: React.SVGProps<SVGSVGElement>) => <Icon {...props} name="x" />,
  wallet: Wallet,
  email: Mail,
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
  subtitle?: string;
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
  const [step, setStep] = React.useState<Step>(() =>
    hasPendingInlineOAuth() ? "oauth" : "choice",
  );
  const [showWallets, setShowWallets] = React.useState(false);
  const walletListId = React.useId();
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
  const icon = (name?: keyof typeof buttonIcons) =>
    name
      ? h(buttonIcons[name], {
          className: `fia-button-icon${name === "spinner" ? " is-spinning" : ""}`,
          "aria-hidden": true,
          focusable: false,
          strokeWidth: 1.8,
        })
      : null;
  const button = (
    label: string,
    onClick?: React.MouseEventHandler<HTMLButtonElement>,
    {
      icon: iconName,
      primary = false,
      link = false,
      subtitle,
      disabled = busy || !ready,
      ...rest
    }: ButtonOptions = {},
  ) => (
    <button
      type="button"
      className={`fia-button${primary ? " fia-primary" : ""}${link ? " fia-link" : ""}${subtitle ? " fia-with-subtitle" : ""}`}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      <span className="fia-button-main">
        {icon(iconName)}
        {label}
      </span>
      {subtitle && <small>{subtitle}</small>}
    </button>
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
  const oauth = () =>
    run(async (current) => {
      // This SDK version redirects for OAuth. Save only a short-lived UI marker.
      window.sessionStorage.setItem(inlineOAuthKey, String(Date.now()));
      setStep("oauth");
      try {
        await initOAuth({
          provider: "twitter",
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
  const brand = (
    <img
      className="fia-brand"
      src={
        props.config?.assets?.fluentLogo ??
        FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo
      }
      alt="Fluent"
    />
  );
  let title: React.ReactNode = brand;
  let description =
    "Sign in with X or email, or connect your Web3 wallet to get started.";
  let content: React.ReactNode;
  if (screen === "choice") {
    content = (
      <React.Fragment>
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
            icon: "fluent",
            primary: true,
            subtitle: "(recommended)",
          },
        )}
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
            setShowWallets((value) => !value);
          },
          {
            icon: "wallet",
            link: true,
            disabled: busy || !wallet?.configured,
            "aria-expanded": showWallets,
            "aria-controls": walletListId,
          },
        )}
        {showWallets && (
          <div
            className="fia-wallets"
            ref={walletList}
            id={walletListId}
            role="group"
            aria-label="Other wallets"
          >
            {wallet?.choices?.length ? (
              wallet.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="fia-button fia-wallet"
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
                    <img className="fia-wallet-icon" src={choice.icon} alt="" />
                  ) : (
                    icon("wallet")
                  )}
                  {choice.name}
                </button>
              ))
            ) : (
              <p className="fia-description">
                {"No wallet connections available."}
              </p>
            )}
            {busy && (
              <div className="fia-progress" role="status">
                <span className="fia-spinner" aria-hidden={true} />
                {"Confirm in your wallet…"}
              </div>
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
        {button("Continue with X", oauth, {
          icon: "x",
          primary: true,
        })}
        {button("Continue with email", () => go("email"), {
          icon: "email",
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
          className="fia-form"
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
          <label className="fia-label" htmlFor="fluent-inline-input">
            {verifying ? "Verification code" : "Email address"}
          </label>
          <input
            ref={input}
            id="fluent-inline-input"
            className="fia-input"
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
    title = screen === "oauth" ? "Continue with X" : "Connecting to Fluent";
    description =
      screen === "oauth"
        ? "Complete sign-in with X to return here."
        : "Preparing your account.";
    content = (
      <React.Fragment>
        {!shownError && (
          <div className="fia-progress" role="status">
            <span className="fia-spinner" aria-hidden={true} />
            {slow ? "Taking longer than usual…" : "Connecting…"}
          </div>
        )}
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
        className="dark fluent-inline-auth"
        initialFocus={heading}
        {...(!description
          ? {
              "aria-describedby": undefined,
            }
          : {})}
      >
        <div className="fia-scroll">
          {screen !== "choice" && brand}
          <div className="fia-screen" key={screen} data-auth-screen={screen}>
            <div className="fia-title" ref={heading} tabIndex={-1}>
              <DialogTitle className="fia-title">{title}</DialogTitle>
            </div>
            {description && (
              <DialogDescription className="fia-description">
                {description}
              </DialogDescription>
            )}
            {content}
            {shownError && (
              <p className="fia-error" role="alert">
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
      </DialogContent>
    </Dialog>
  );
}
