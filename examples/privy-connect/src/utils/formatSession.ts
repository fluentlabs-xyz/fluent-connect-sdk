import { FluentWidgetSession } from "../const";
  
export function formatSession(session: FluentWidgetSession | null): string {
  if (!session) return "Waiting for Fluent login";

  return JSON.stringify(
    {
      clientId: session.clientId,
      user: session.user,
      wallet: session.wallet,
      scopes: session.scopes,
      issuedAt: session.issuedAt,
      idToken: session.idToken,
    },
    null,
    2,
  );
}
