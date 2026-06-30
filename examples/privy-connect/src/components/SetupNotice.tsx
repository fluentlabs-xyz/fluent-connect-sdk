export function SetupNotice() {
  return (
    <section className="notice">
      <h2>Configure real auth</h2>
      <p>
        Add <code>VITE_PRIVY_APP_ID</code> to <code>examples/privy-connect/.env</code>.
        Optional backend hooks are <code>VITE_FLUENT_SESSION_ENDPOINT</code>,{" "}
        <code>VITE_FLUENT_FAUCET_ENDPOINT</code>, and <code>VITE_FLUENT_EVENTS_ENDPOINT</code>.
      </p>
    </section>
  );
}
