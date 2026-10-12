import {
  ConnectBrandTitle,
  ConnectButton,
  ConnectEmailForm,
  ConnectScreen,
  ConnectSpinner,
  ConnectWalletList,
  type ConnectScreenProps,
} from "@fluent.xyz/connect/internal/components/ConnectDialog";
import type { ReactNode } from "react";

import type { SpecimenStatus } from "../Specimen";
import { noop } from "./config";
import { walletChoices } from "./wallet";

export type ConnectScreenSpecimen = {
  id: string;
  title: string;
  note: string;
  status: SpecimenStatus;
  render: () => ReactNode;
};

const CHOICE_DESCRIPTION =
  "Use Fluent Connect to access your reputation, positions, and rewards.";

/** The methods the choice screen lists with every auth method enabled. */
export function methods() {
  return (
    <>
      <ConnectButton label="Continue with X" icon="x" primary onClick={noop} />
      <ConnectButton label="Continue with Google" icon="google" onClick={noop} />
      <ConnectButton label="Continue with email" icon="email" onClick={noop} />
      <ConnectButton label="Continue with passkey" icon="passkey" onClick={noop} />
    </>
  );
}

function otherWalletsLink(disabled = false) {
  return (
    <div className="flex justify-center">
      <ConnectButton label="Other wallets" link disabled={disabled} onClick={noop} />
    </div>
  );
}

/** The choice screen's body with the host's wallets unfolded, for the live dialog. */
export function choiceWithWallets() {
  return (
    <>
      {methods()}
      <ConnectWalletList choices={walletChoices} disabled={false} onChoose={noop} />
    </>
  );
}

/** The choice screen's shared frame. */
export function choiceScreen(props: Partial<ConnectScreenProps> & { children: ReactNode }) {
  return (
    <ConnectScreen
      screen="choice"
      title={<ConnectBrandTitle />}
      description={CHOICE_DESCRIPTION}
      {...props}
    />
  );
}

/**
 * Every screen of the direct-login flow, each as `InlineConnectModal` would
 * render it, with the Privy state it would be in spelled out in the note.
 */
export const connectScreens: ConnectScreenSpecimen[] = [
  {
    id: "connect-choice",
    title: "Choice",
    note: "Every auth method enabled; the host's wallets fold behind the link.",
    status: "legacy",
    render: () =>
      choiceScreen({
        children: (
          <>
            {methods()}
            {otherWalletsLink()}
          </>
        ),
      }),
  },
  {
    id: "connect-choice-wallets",
    title: "Choice — wallets expanded",
    note: "The link gave way to the host's choices: an injected wallet with an icon, one without, and a hand-off to the WalletConnect QR.",
    status: "legacy",
    render: () => choiceScreen({ children: choiceWithWallets() }),
  },
  {
    id: "connect-choice-no-wallets",
    title: "Choice — no wallets",
    note: "Expanded, but the host configured none.",
    status: "legacy",
    render: () =>
      choiceScreen({
        children: (
          <>
            {methods()}
            <ConnectWalletList choices={[]} disabled={false} onChoose={noop} />
          </>
        ),
      }),
  },
  {
    id: "connect-choice-error",
    title: "Choice — error",
    note: "A method failed and the dialog is back on the methods with its message.",
    status: "legacy",
    render: () =>
      choiceScreen({
        error: "Could not sign in. Please try again.",
        children: (
          <>
            {methods()}
            {otherWalletsLink()}
          </>
        ),
      }),
  },
  {
    id: "connect-choice-captcha",
    title: "Choice — verification failed",
    note: "Privy's captcha could not load; the footer link retries it.",
    status: "legacy",
    render: () =>
      choiceScreen({
        error: "Verification could not load. Please retry.",
        footer: <ConnectButton label="Retry verification" icon="retry" link onClick={noop} />,
        children: (
          <>
            {methods()}
            {otherWalletsLink()}
          </>
        ),
      }),
  },
  {
    id: "connect-wallet",
    title: "Wallet — waiting",
    note: "An injected wallet was picked; its own prompt is open.",
    status: "legacy",
    render: () => (
      <ConnectScreen
        screen="wallet"
        title="Connecting to MetaMask"
        description="Approve the connection request in your wallet."
        headerIcon={<ConnectSpinner label="Waiting for your wallet" className="mb-3" />}
      >
        <ConnectButton label="Back" icon="back" onClick={noop} />
      </ConnectScreen>
    ),
  },
  {
    id: "connect-wallet-error",
    title: "Wallet — rejected",
    note: "The wallet refused; the request can be retried from here.",
    status: "legacy",
    render: () => (
      <ConnectScreen
        screen="wallet"
        title="Connecting to MetaMask"
        description="Approve the connection request in your wallet."
        error="User rejected the request."
      >
        <ConnectButton label="Try again" icon="retry" onClick={noop} />
        <ConnectButton label="Back" icon="back" onClick={noop} />
      </ConnectScreen>
    ),
  },
  {
    id: "connect-email",
    title: "Email",
    note: "The address step of the email method.",
    status: "legacy",
    render: () => (
      <ConnectScreen
        screen="email"
        title="Sign in with email"
        description="We’ll send you a sign-in code."
      >
        <ConnectEmailForm
          verifying={false}
          value=""
          onChange={noop}
          onSubmit={noop}
          disabled={false}
          submitLabel="Send code"
          submitIcon="send"
        />
        <ConnectButton label="Back" icon="back" link onClick={noop} />
      </ConnectScreen>
    ),
  },
  {
    id: "connect-code",
    title: "Code",
    note: "The code step, 30 seconds after the code went out.",
    status: "legacy",
    render: () => (
      <ConnectScreen
        screen="code"
        title="Check your email"
        description="Enter the code sent to rook@example.com."
      >
        <ConnectEmailForm
          verifying
          value="123"
          onChange={noop}
          onSubmit={noop}
          disabled={false}
          submitLabel="Sign in"
          submitIcon="signIn"
        />
        <ConnectButton label="Resend code in 30s" icon="retry" link disabled onClick={noop} />
        <ConnectButton label="Change email" icon="email" link onClick={noop} />
      </ConnectScreen>
    ),
  },
  {
    id: "connect-code-busy",
    title: "Code — signing in",
    note: "The code is being checked; everything is held down.",
    status: "legacy",
    render: () => (
      <ConnectScreen
        screen="code"
        title="Check your email"
        description="Enter the code sent to rook@example.com."
      >
        <ConnectEmailForm
          verifying
          value="123456"
          onChange={noop}
          onSubmit={noop}
          disabled
          submitLabel="Signing in…"
          submitIcon="spinner"
        />
        <ConnectButton label="Resend code" icon="retry" link disabled onClick={noop} />
        <ConnectButton label="Change email" icon="email" link disabled onClick={noop} />
      </ConnectScreen>
    ),
  },
  {
    id: "connect-oauth",
    title: "OAuth",
    note: "Shown on the return URL while the provider's redirect completes.",
    status: "legacy",
    render: () => (
      <ConnectScreen
        screen="oauth"
        title="Continue with X"
        description="Complete sign-in with X to return here."
        headerIcon={<ConnectSpinner label="Waiting for X" className="mb-1" />}
      >
        <ConnectButton label="Back" icon="back" onClick={noop} />
      </ConnectScreen>
    ),
  },
  {
    id: "connect-connecting",
    title: "Connecting",
    note: "Signed in with Privy; the Fluent ID is being prepared.",
    status: "legacy",
    render: () => (
      <ConnectScreen
        screen="connecting"
        title="Connecting to Fluent"
        description="Preparing your account."
        headerIcon={<ConnectSpinner label="Preparing your account" className="mb-1" />}
      >
        <ConnectButton label="Cancel" icon="close" link onClick={noop} />
      </ConnectScreen>
    ),
  },
  {
    id: "connect-connecting-error",
    title: "Connecting — failed",
    note: "The wallet could not be created, or 20 seconds passed: Try again appears.",
    status: "legacy",
    render: () => (
      <ConnectScreen
        screen="connecting"
        title="Connecting to Fluent"
        description="Preparing your account."
        error="Could not create your wallet."
      >
        <ConnectButton label="Try again" icon="retry" onClick={noop} />
        <ConnectButton label="Cancel" icon="close" link onClick={noop} />
      </ConnectScreen>
    ),
  },
];
