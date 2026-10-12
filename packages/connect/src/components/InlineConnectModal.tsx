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
  ConnectBrandTitle,
  ConnectButton,
  ConnectDialog,
  ConnectDialogViewport,
  ConnectEmailForm,
  ConnectScreen,
  ConnectSpinner,
  ConnectWalletList,
  type ConnectButtonProps,
} from "./ConnectDialog";
import {
  resolveFluentWidgetAuthMethods,
  type FluentWidgetAuthMethod,
} from "../core/config";
import type { FluentWalletChoice } from "../core/types";
import type { ConnectChoiceModalProps } from "./ConnectChoiceModal";
import {
  clearInlineOAuth,
  getPendingInlineOAuth,
  hasPendingInlineOAuth,
  inlineOAuthKey,
  type InlineOAuthProvider,
} from "../utils/inlineOAuth";
type Step =
  | "choice"
  | "wallet"
  | "email"
  | "code"
  | "oauth"
  | "connecting";
type ButtonOptions = Omit<ConnectButtonProps, "label" | "onClick">;
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
    config,
    walletUserPrivySession = false,
  } = props;
  // X is unconditional; the host config only decides what stands beside it.
  const authMethods = React.useMemo(
    () => resolveFluentWidgetAuthMethods(config?.enabledAuthMethods),
    [config?.enabledAuthMethods],
  );
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
  const attemptedWallet = React.useRef<string | null>(null);
  const walletFailed = React.useRef(false);
  const fluentChosen = React.useRef(false);
  // What `onFluentLogin` answered: `undefined` until asked, `null` when the host has nothing to
  // wait for, else the work every Fluent method waits on before it runs.
  const fluentGate = React.useRef<Promise<void> | null | undefined>(undefined);
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
    if (!open || !connecting || !walletsReady || !user?.id || walletUserPrivySession) return;
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
    walletUserPrivySession,
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
  // Every button in the flow is held down while an operation runs or Privy is
  // not ready, unless the screen says otherwise.
  const button = (
    label: string,
    onClick?: React.MouseEventHandler<HTMLButtonElement>,
    { disabled = busy || !ready, ...rest }: ButtonOptions = {},
  ) => <ConnectButton label={label} onClick={onClick} disabled={disabled} {...rest} />;
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
    if (walletFailed.current) attemptedWallet.current = null;
    setWalletAttempt((value) => value + 1);
    onRetry?.();
  };
  let title: React.ReactNode = "Sign in";
  let description =
    "Use Fluent Connect to access your reputation, positions, and rewards.";
  let content: React.ReactNode;
  // Sits above the title; only the waits use it so far.
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
    title = <ConnectBrandTitle />;
    content = (
      <React.Fragment>
        {button("Continue with X", () => oauth("twitter"), {
          icon: "x",
          primary: true,
        })}
        {authMethods.map((method) => (
          <React.Fragment key={method}>
            {authMethodButton(method)}
          </React.Fragment>
        ))}
        {/* The link gives way to the list: once expanded it stays open until the dialog closes. */}
        {showWallets ? (
          <ConnectWalletList
            choices={wallet?.choices}
            disabled={busy}
            onChoose={connectWallet}
            listRef={walletList}
          />
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
  } else if (screen === "wallet") {
    title = `Connecting to ${walletChoice?.name ?? "wallet"}`;
    description = "Approve the connection request in your wallet.";
    // The title and description say what to do; the spinner above them says
    // the request is still out.
    if (!shownError)
      headerIcon = <ConnectSpinner label="Waiting for your wallet" className="mb-3" />;
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
        <ConnectEmailForm
          verifying={verifying}
          value={verifying ? code : email}
          onChange={(value) =>
            verifying
              ? setCode(value.replace(/\D/g, "").slice(0, 6))
              : setEmail(value)
          }
          onSubmit={() => {
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
          disabled={busy}
          submitDisabled={busy || !ready}
          submitLabel={
            busy
              ? verifying
                ? "Signing in…"
                : "Sending code…"
              : verifying
                ? "Sign in"
                : "Send code"
          }
          submitIcon={busy ? "spinner" : verifying ? "signIn" : "send"}
          inputRef={input}
        />
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
        <ConnectSpinner
          label={screen === "oauth" ? `Waiting for ${oauthName}` : "Preparing your account"}
          className="mb-1"
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
    <ConnectDialog
      open={open && !securityPromptOpen}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      initialFocus={heading}
      className="flex max-h-[calc(100dvh-2rem)] flex-col"
    >
      <ConnectDialogViewport>
        <ConnectScreen
          key={screen}
          screen={screen}
          title={title}
          description={description}
          headerIcon={headerIcon}
          error={shownError || undefined}
          headingRef={heading}
          footer={
            captchaError &&
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
            )
          }
        >
          {content}
        </ConnectScreen>
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
      </ConnectDialogViewport>
    </ConnectDialog>
  );
}
