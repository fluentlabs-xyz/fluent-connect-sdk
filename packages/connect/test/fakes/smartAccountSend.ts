/**
 * A Fluent ID's smart account as the widget builds it, for the tests of what one send reports:
 * `useFluentZeroDevAccount` (`src/widget/zerodevSession.ts`) beside `useAuthToken`, wired the
 * way `FluentWidgetContent` wires them (the App id, the sponsorship URL and the token source
 * `requestSponsorshipToken`), both running for real.
 *
 * A test file that uses it mocks `@privy-io/react-auth`, `@zerodev/sdk` and
 * `@zerodev/ecdsa-validator` with the factories of `./fluentId`, and stubs `fetch` with its
 * `stubNetwork()`; those are the only fakes.
 */
import { renderHook } from "@testing-library/react";

import {
  FLUENT_CONNECT_DEFAULT_EXECUTION,
  FLUENT_CONNECT_TESTNET_PUBLIC_API_URL,
  FLUENT_CONNECT_TESTNET_SPONSORSHIP_URL,
  type ResolvedFluentWidgetExecution,
} from "../../src/core/config";
import { useAuthToken } from "../../src/widget/hooks/useAuthToken";
import { useFluentZeroDevAccount } from "../../src/widget/zerodevSession";
import { PRIVY_IDENTITY_TOKEN, PRIVY_USER } from "./fluentId";

export const APP_ID = "app_8908941315934a06b738c6804ce26132";

/**
 * The smart account of the latest render. `sponsored` configures the App's sponsorship, as
 * the widget does on every network that has a sponsorship URL; `execution` is the host's
 * `config.execution`.
 */
export function renderSmartAccount(options: {
  sponsored?: boolean;
  execution?: Partial<ResolvedFluentWidgetExecution>;
} = {}) {
  const { result } = renderHook(() => {
    const { requestSponsorshipToken } = useAuthToken({
      publicApiUrl: FLUENT_CONNECT_TESTNET_PUBLIC_API_URL,
      appId: APP_ID,
      renewalOffsetSeconds: 30,
      accountType: "smart",
      privyUserId: PRIVY_USER,
      getAccessToken: async () => "privy-access-token",
      identityToken: PRIVY_IDENTITY_TOKEN,
      storage: null,
    });
    return useFluentZeroDevAccount({
      ...(options.sponsored
        ? {
            appId: APP_ID,
            sponsorshipUrl: FLUENT_CONNECT_TESTNET_SPONSORSHIP_URL,
            sponsorshipTokenSource: () => ({
              accountType: "smart" as const,
              getAuthToken: requestSponsorshipToken,
            }),
          }
        : {}),
      execution: { ...FLUENT_CONNECT_DEFAULT_EXECUTION, ...options.execution },
    });
  });
  return result;
}
