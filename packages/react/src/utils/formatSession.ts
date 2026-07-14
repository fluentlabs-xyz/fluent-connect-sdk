import { type FluentWidgetSession } from "../config";

export function formatSession(session: FluentWidgetSession | null): string {
  if (!session) return "Waiting for Fluent login";

  return JSON.stringify(
    {
      app: {
        mode: session.app.mode,
        origin: session.app.origin,
        installationId: session.app.installationId,
        clientId: session.app.clientId,
        appName: session.app.appName,
      },
      user: session.user,
      wallet: {
        smartAccountAddress: session.wallet.smartAccountAddress,
      },
      scopes: session.scopes,
      issuedAt: session.issuedAt,
      idToken: session.idToken,
    },
    null,
    2,
  );
}
