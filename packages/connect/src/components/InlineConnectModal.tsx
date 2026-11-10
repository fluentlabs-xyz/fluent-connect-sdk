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
} from "../widget/privyAdapter";
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
import { toast } from "./ui/toast";
import { Icon } from "./Icon";
import wordmarkConnect from "../assets/brand/wordmark-connect.png";
import wordmarkFluent from "../assets/brand/wordmark-fluent.png";
import { version as SDK_VERSION } from "../../package.json";
import {
  BranchDivider,
  connectDescription,
  FluentBranch,
  WalletBranchNote,
  walletRowClassName,
} from "./ConnectBranches";
import type { FluentAnalyticsTrack } from "../core/analytics";
import {
  resolveFluentWidgetAuthMethods,
  type FluentWidgetAuthMethod,
  type FluentWidgetConfig,
} from "../core/config";
import type { FluentExternalWalletState, FluentWalletChoice } from "../core/types";
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
type Step =
  | "choice"
  | "wallet"
  | "email"
  | "code"
  | "oauth"
  | "connecting";
type SignerCreationAttempt = { userId: string; failed: boolean };
type ButtonOptions = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: keyof typeof buttonIcons;
  primary?: boolean;
  link?: boolean;
  /** Sits after the label, e.g. a chevron on a row that opens a list. */
  trailing?: React.ReactNode;
};
// viem errors carry a multi-line message ("Details: …", "Version: …"); the
// short form is the line a user can act on. Wallet SDKs may reject with a
// plain object, which still names its reason.
const message = (error: unknown) => {
  const text = (key: "shortMessage" | "message") =>
    typeof error === "object" &&
    error !== null &&
    key in error &&
    typeof (error as Record<string, unknown>)[key] === "string"
      ? ((error as Record<string, string>)[key] ?? "")
      : "";
  return (
    text("shortMessage") || text("message") || "Could not sign in. Please try again."
  );
};
export type InlineConnectModalProps = {
  track: FluentAnalyticsTrack;
  /** The user committed to the external-wallet branch — the connect funnel's other arm. */
  onExternalWalletSelected: () => void;
  open: boolean;
  wallet: FluentExternalWalletState | null;
  onClose: () => void;
  /**
   * The user chose the Fluent branch. A promise answers with work the host has to finish
   * before any Fluent sign-in method may run — the widget signs a wallet user's Privy session
   * out first — and the dialog runs no method until it resolves; its rejection runs none
   * and is shown as the dialog's error. A host with nothing to wait for returns nothing.
   */
  onFluentLogin: () => void | Promise<void>;
  /** A SIWE session must never acquire an embedded wallet through the connect modal. */
  walletUserPrivySession?: boolean;
  /**
   * Why the sign-in this dialog is waiting on cannot be completed on the Privy session the page
   * holds. Shown in place of the wait, with a "Try again" that starts the sign-in over at the
   * methods rather than re-running an authorization this session will refuse again. `null` when
   * nothing stands in the way, which is every ordinary sign-in.
   */
  signInRefusal?: string | null;
  config?: FluentWidgetConfig;
  /** The last login failure the widget reported, shown while the dialog waits. */
  loginError?: string | null;
  onRetry?: () => void;
  /** Show a failed Signer preparation even when the OAuth return did not reopen this dialog. */
  onSignerCreationError?: () => void;
};

export function InlineConnectModal(props: InlineConnectModalProps) {
  const {
    open,
    onClose,
    onFluentLogin,
    onRetry,
    onSignerCreationError,
    loginError,
    wallet,
    track,
    onExternalWalletSelected,
    config,
    walletUserPrivySession = false,
    signInRefusal = null,
  } = props;
  // X is unconditional; the host config only decides what stands beside it.
  const authMethods = React.useMemo(
    () => resolveFluentWidgetAuthMethods(config?.enabledAuthMethods),
    [config?.enabledAuthMethods],
  );
  const { ready, authenticated, user } = usePrivy();
  const { isOpen: securityPromptOpen } = useModalStatus();
  const { wallets } = useWallets();
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
  const [walletChoice, setWalletChoice] =
    React.useState<FluentWalletChoice | null>(null);
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
  const attemptedWallet = React.useRef<SignerCreationAttempt | null>(null);
  const [signerError, setSignerError] = React.useState<{
    attempt: SignerCreationAttempt;
    message: string;
  } | null>(null);
  const signerUserId = authenticated && !walletUserPrivySession ? user?.id : undefined;
  // A late failure belongs to the attempt that started it, including across logout and re-login
  // to the same Fluent ID. Neither its retry state nor its error belongs to the next user.
  if (attemptedWallet.current?.userId !== signerUserId) attemptedWallet.current = null;
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fluentChosen = React.useRef(false);
  // What `onFluentLogin` answered: `undefined` until asked, `null` when the host has nothing to
  // wait for, else the work every Fluent method waits on before it runs.
  const fluentGate = React.useRef<Promise<void> | null | undefined>(undefined);
  const heading = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const walletList = React.useRef<HTMLDivElement>(null);
  const active = React.useRef(open);
  active.current = open;
  const connecting = authenticated && (step !== "choice" || !walletUserPrivySession);
  const screen = connecting ? "connecting" : step;
  // A refusal comes before the host's error: it names the one thing in the way, and the error
  // beside it is whatever the wait had already reported.
  const shownError =
    error ||
    captchaError ||
    (signerError?.attempt === attemptedWallet.current ? signerError?.message : "") ||
    (connecting ? signInRefusal || loginError : "");
  // Every error the dialog has is raised as a toast, which slides in from the
  // dialog's own bottom edge, rather than written under its buttons. The toast
  // lives as long as the error does: cleared by a retry, a step change or the
  // dialog closing, it goes too, so a stale failure never outlives the attempt.
  React.useEffect(() => {
    if (!open || !shownError) return;
    const id = toast.add({ type: "error", title: shownError });
    return () => toast.close(id);
  }, [open, shownError]);
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
      fluentChosen.current = false;
      fluentGate.current = undefined;
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
    setStep("choice");
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
    if (!ready || !authenticated || !user?.id || walletUserPrivySession) return;
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
    // The wallet list can stay unready before the first Signer exists. Waiting for that list
    // would block creation itself; the authenticated user's linked accounts identify an existing
    // Signer above. Keep one attempt until explicit retry or a change of user.
    if (attemptedWallet.current?.userId === user.id) return;
    const attempt = { userId: user.id, failed: false };
    attemptedWallet.current = attempt;
    setSignerError(null);
    void createWallet().catch((failure) => {
      if (!mounted.current || attemptedWallet.current !== attempt) return;
      attempt.failed = true;
      const detail = message(failure);
      setSignerError({ attempt, message: detail });
      onSignerCreationError?.();
    });
  }, [
    ready,
    authenticated,
    wallets,
    user,
    createWallet,
    walletAttempt,
    walletUserPrivySession,
    onSignerCreationError,
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
  // Every Fluent method is the Fluent branch of the connect funnel; the host
  // hears about it once per dialog, however many retries follow. The host may
  // answer with work that has to finish before any Fluent method runs — the
  // widget signs a wallet user's Privy session out first — so each method
  // awaits what this returns before it reaches Privy; a host with nothing to
  // wait for gates nothing, and the method runs at once. Work that failed is
  // not remembered: the next click asks the host again, after its error has
  // been shown in the dialog.
  const chooseFluent = (): Promise<void> | null => {
    if (fluentGate.current !== undefined) return fluentGate.current;
    if (!fluentChosen.current) {
      fluentChosen.current = true;
      track("connect_method_selected", {
        method: "fluent",
      });
    }
    const answer = onFluentLogin();
    if (!answer) {
      fluentGate.current = null;
      return null;
    }
    const gate: Promise<void> = answer.then(undefined, (failure: unknown) => {
      if (fluentGate.current === gate) fluentGate.current = undefined;
      throw failure;
    });
    fluentGate.current = gate;
    return gate;
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
      trailing,
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
      {trailing}
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
  const passkey = () =>
    run(async (current) => {
      const gate = chooseFluent();
      if (gate) {
        await gate;
        if (!current()) return;
      }
      await loginWithPasskey();
      if (current()) setStep("connecting");
    });
  const oauth = (provider: InlineOAuthProvider) =>
    run(async (current) => {
      // Before the marker and the step: `initOAuth` leaves the page, and the
      // "connecting" screens act on whoever Privy still reports.
      const gate = chooseFluent();
      if (gate) {
        await gate;
        if (!current()) return;
      }
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
        if (current()) setStep("choice");
        throw failure;
      }
    });
  const connectWallet = (choice: FluentWalletChoice) =>
    run(async (current) => {
      track("connect_method_selected", {
        method: "external",
        wallet: choice.name,
      });
      onExternalWalletSelected();
      // Only a wallet selection can request authorization. Expanding
      // this list never opens AppKit or calls a wallet provider.
      if (choice.handoff) close();
      else {
        setWalletChoice(choice);
        setStep("wallet");
      }
      // A rejection stays on the wallet screen, where it can be retried.
      await wallet?.connectChoice?.(choice.id);
      if (current()) close();
    }, false);
  const retry = () => {
    setError("");
    setSlow(false);
    // Nothing about this wait can be retried: the session the page holds is not this sign-in's,
    // and asking the host to authorize it again would be refused for the same reason. What is
    // left is to start over, at the methods, with the resume marker dropped.
    if (signInRefusal) {
      clearInlineOAuth();
      setStep("choice");
      return;
    }
    if (attemptedWallet.current?.failed) attemptedWallet.current = null;
    setWalletAttempt((value) => value + 1);
    onRetry?.();
  };
  let title: React.ReactNode = "Sign in";
  let description = connectDescription(config?.appName);
  let content: React.ReactNode;
  // Sits above the title; only the wallet wait uses it so far.
  let headerIcon: React.ReactNode = null;
  const authMethodButton = (method: FluentWidgetAuthMethod) => {
    if (method === "google")
      return button("Continue with Google", () => oauth("google"), {
        icon: "google",
      });
    if (method === "email")
      return button(
        "Continue with email",
        () => {
          const gate = chooseFluent();
          if (!gate) {
            go("email");
            return;
          }
          void run(async (current) => {
            await gate;
            if (current()) go("email");
          });
        },
        {
          icon: "email",
        },
      );
    return button(busy ? "Signing in…" : "Continue with passkey", passkey, {
      icon: busy ? "spinner" : "passkey",
    });
  };

  if (screen === "choice") {
    // The brand lockup stands in for the heading; the text stays for assistive tech.
    title = (
      <span className="my-3 flex items-start justify-center">
        <img src={wordmarkFluent} alt="" className="h-[26px] w-auto" />
        <span aria-hidden="true" className="mt-[3px] ml-px w-[7px] text-[9px] leading-none">
          ®
        </span>
        <img src={wordmarkConnect} alt="" className="h-[26px] w-auto" />
        <span className="sr-only">Sign in</span>
      </span>
    );
    content = (
      <React.Fragment>
        <FluentBranch>
          {button("Continue with X", () => oauth("twitter"), {
            icon: "x",
            primary: true,
          })}
          {authMethods.map((method) => (
            <React.Fragment key={method}>
              {authMethodButton(method)}
            </React.Fragment>
          ))}
        </FluentBranch>
        <BranchDivider />
        {/* Inset to the panel's button width, so the wallet row lines up with the methods above it. */}
        <div className="flex flex-col gap-2 px-5">
          {/* The row gives way to the list: once expanded it stays open until the dialog closes. */}
          {showWallets ? (
            <div
              className="flex flex-col gap-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
              ref={walletList}
              role="group"
              aria-label="Connect with other wallets"
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
                    onClick={() => connectWallet(choice)}
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
              <WalletBranchNote />
            </div>
          ) : (
            <React.Fragment>
              {button(
                "Connect with other wallets",
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
                  icon: "wallet",
                  disabled: busy || !wallet?.configured,
                  className: walletRowClassName,
                },
              )}
              <WalletBranchNote />
            </React.Fragment>
          )}
        </div>
      </React.Fragment>
    );
  } else if (screen === "wallet") {
    title = `Connecting to ${walletChoice?.name ?? "wallet"}`;
    description = "Approve the connection request in your wallet.";
    // The title and description say what to do; the spinner above them says
    // the request is still out.
    if (!shownError)
      headerIcon = (
        <Loader2
          className="mx-auto mb-3 size-6 animate-spin text-white/80 motion-reduce:animate-none"
          role="status"
          aria-label="Waiting for your wallet"
        />
      );
    content = (
      <React.Fragment>
        {shownError &&
          walletChoice &&
          button("Try again", () => connectWallet(walletChoice), {
            icon: "retry",
            disabled: busy,
          })}
        {button(
          "Back",
          () => {
            // The pending request is orphaned: a late answer must not close
            // the dialog or connect behind the user's back.
            generation.current++;
            setBusy(false);
            setError("");
            setStep("choice");
          },
          {
            icon: "back",
            disabled: false,
          },
        )}
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
          () => go(verifying ? "email" : "choice"),
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
    if (!shownError)
      headerIcon = (
        <Loader2
          className="mx-auto mb-1 size-6 animate-spin text-white/80 motion-reduce:animate-none"
          role="status"
          aria-label={screen === "oauth" ? `Waiting for ${oauthName}` : "Preparing your account"}
        />
      );
    content =
      screen === "oauth" ? (
        // Back is the retry: it drops the resume marker and returns to the
        // methods, where the provider can be picked again.
        button(
          "Back",
          () => {
            clearInlineOAuth();
            go("choice");
          },
          {
            icon: "back",
            disabled: false,
          },
        )
      ) : (
        <React.Fragment>
          {(shownError || slow) &&
            button("Try again", retry, {
              icon: "retry",
              disabled: false,
            })}
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
        className="dark flex max-h-[calc(100dvh-32px)] flex-col overflow-visible text-white antialiased"
      >
        {/* The scroll viewport sits above the gradient; its clip edge meets the popup edge. */}
        <div className="relative z-20 -m-4 min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-[inherit] p-4">
          <div
            key={screen}
            data-auth-screen={screen}
            className="flex flex-col animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
          >
            <DialogHeader className="items-center px-4 pt-5 pb-3 text-center">
              {headerIcon}
              <div ref={heading} tabIndex={-1} className="outline-none">
                <DialogTitle>{title}</DialogTitle>
              </div>
              <DialogDescription
                className={cn(
                  "break-words text-balance",
                  // Quieter under the lockup, where it sits on the brightest part of the gradient.
                  screen === "choice" && "text-white/60",
                )}
              >
                {description}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 p-2.5">
              {content}
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
        {/* The popup no longer clips, so the badge can hang below its bottom edge; the scroll viewport clips to the rounded corners instead. */}
        <span className="pointer-events-none absolute top-full left-1/2 mt-2.5 -translate-x-1/2 rounded-full bg-white/5 px-1.5 text-[9px] font-medium leading-[14px] text-white/35 backdrop-blur-md select-none">
          v{SDK_VERSION}
        </span>
      </DialogContent>
    </Dialog>
  );
}
