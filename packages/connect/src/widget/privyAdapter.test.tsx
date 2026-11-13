import { createElement } from "react";
// @ts-expect-error react-test-renderer has no declarations in this test suite.
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import { FluentPrivyProvider, usePrivy, useWallets, type FluentPrivyAdapter } from "./privyAdapter";

const web = vi.hoisted(() => ({
  provider: vi.fn(),
  usePrivy: vi.fn(() => ({ ready: true, authenticated: false })),
  useWallets: vi.fn(() => ({ ready: true, wallets: [] })),
}));
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: (props: { children: React.ReactNode }) => {
    web.provider(props);
    return props.children;
  },
  usePrivy: web.usePrivy,
  useWallets: web.useWallets,
}));
beforeEach(() => vi.clearAllMocks());

/** The native app's own Privy provider, handed in through the adapter. */
const nativeProvider = vi.fn();
function NativePrivyProvider(props: { children: React.ReactNode }) {
  nativeProvider(props);
  return props.children;
}

function Probe() {
  const auth = usePrivy();
  const wallets = useWallets();
  return createElement("span", null, `${auth.authenticated}:${wallets.wallets.length}`);
}
it("keeps the web Privy provider and hooks by default", () => {
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(
      <FluentPrivyProvider appId="privy-app" clientId="web-client">
        <Probe />
      </FluentPrivyProvider>,
    );
  });
  expect(web.provider).toHaveBeenCalledWith(
    expect.objectContaining({ appId: "privy-app", clientId: "web-client" }),
  );
  expect(web.usePrivy).toHaveBeenCalledOnce();
  expect(root.toJSON()).toMatchObject({ children: ["false:0"] });
  act(() => root.unmount());
});
it("uses the supplied native session and wallet provider without mounting web Privy", () => {
  const provider = nativeProvider;
  const adapter = {
    PrivyProvider: NativePrivyProvider,
    usePrivy: () => ({ ready: true, authenticated: true }),
    useWallets: () => ({ ready: true, wallets: [{ address: "0x123" }] }),
  } as unknown as FluentPrivyAdapter;
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(
      <FluentPrivyProvider adapter={adapter} appId="privy-app" clientId="mobile-client">
        <Probe />
      </FluentPrivyProvider>,
    );
  });
  expect(web.provider).not.toHaveBeenCalled();
  expect(web.usePrivy).not.toHaveBeenCalled();
  expect(web.useWallets).not.toHaveBeenCalled();
  expect(provider).toHaveBeenCalledWith(
    expect.objectContaining({ appId: "privy-app", clientId: "mobile-client" }),
  );
  expect(root.toJSON()).toMatchObject({ children: ["true:1"] });
  act(() => root.unmount());
});
