import { createContext, useContext, type ComponentProps } from "react";
import * as web from "@privy-io/react-auth";

/**
 * Privy runtime supplied by a host using a native SDK. Its Provider owns session
 * restoration, login and wallet RPC; web hosts keep the normal React SDK.
 * Keep one stable adapter per runtime. Changing its Provider remounts descendants
 * so React hooks from different SDKs never share a component lifetime.
 */
export type FluentPrivyAdapter = Pick<
  typeof web,
  | "PrivyProvider"
  | "Captcha"
  | "usePrivy"
  | "useSignMessage"
  | "useSignTypedData"
  | "useWallets"
  | "useIdentityToken"
  | "useUser"
  | "useLinkAccount"
  | "useLoginWithSiwe"
  | "useModalStatus"
  | "useCreateWallet"
  | "useLoginWithEmail"
  | "useLoginWithOAuth"
  | "useLoginWithPasskey"
  | "useLinkWithPasskey"
>;

const AdapterContext = createContext<FluentPrivyAdapter | null>(null);

type ProviderProps = ComponentProps<typeof web.PrivyProvider> & {
  adapter?: FluentPrivyAdapter;
};

export function FluentPrivyProvider({ adapter, ...props }: ProviderProps) {
  const Provider = adapter?.PrivyProvider ?? web.PrivyProvider;
  return (
    <AdapterContext.Provider value={adapter ?? null}>
      <Provider {...props} />
    </AdapterContext.Provider>
  );
}

export const usePrivy: typeof web.usePrivy = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.usePrivy ?? web.usePrivy)(...args);
};

export const useSignMessage: typeof web.useSignMessage = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useSignMessage ?? web.useSignMessage)(...args);
};

export const useSignTypedData: typeof web.useSignTypedData = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useSignTypedData ?? web.useSignTypedData)(...args);
};

export const useWallets: typeof web.useWallets = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useWallets ?? web.useWallets)(...args);
};

export const useIdentityToken: typeof web.useIdentityToken = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useIdentityToken ?? web.useIdentityToken)(...args);
};

export const useUser: typeof web.useUser = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useUser ?? web.useUser)(...args);
};

export const useLinkAccount: typeof web.useLinkAccount = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useLinkAccount ?? web.useLinkAccount)(...args);
};

export const useLoginWithSiwe: typeof web.useLoginWithSiwe = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useLoginWithSiwe ?? web.useLoginWithSiwe)(...args);
};

export const useModalStatus: typeof web.useModalStatus = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useModalStatus ?? web.useModalStatus)(...args);
};

export const useCreateWallet: typeof web.useCreateWallet = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useCreateWallet ?? web.useCreateWallet)(...args);
};

export const useLoginWithEmail: typeof web.useLoginWithEmail = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useLoginWithEmail ?? web.useLoginWithEmail)(...args);
};

export const useLoginWithOAuth: typeof web.useLoginWithOAuth = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useLoginWithOAuth ?? web.useLoginWithOAuth)(...args);
};

export const useLoginWithPasskey: typeof web.useLoginWithPasskey = (
  ...args
) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useLoginWithPasskey ?? web.useLoginWithPasskey)(...args);
};

export const useLinkWithPasskey: typeof web.useLinkWithPasskey = (...args) => {
  const adapter = useContext(AdapterContext);
  return (adapter?.useLinkWithPasskey ?? web.useLinkWithPasskey)(...args);
};

export function Captcha(props: ComponentProps<typeof web.Captcha>) {
  const adapter = useContext(AdapterContext);
  const Component = adapter?.Captcha ?? web.Captcha;
  return <Component {...props} />;
}
