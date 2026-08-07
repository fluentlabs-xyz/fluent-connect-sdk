# Environment configs

This folder contains non-secret runtime config for local demos and deployments.

Use the runner from the repo root:

```bash
pnpm config:run local -- pnpm --filter mock-fluent-connect-main dev --host 0.0.0.0 --port 5173
pnpm config:run local -- pnpm --filter app-chess dev --host 0.0.0.0 --port 5173
```

Both local commands use 5173 because it is the only localhost origin registered in the Fluent Privy project. Run one at a time.

Shortcuts are available:

```bash
pnpm dev:main:local
pnpm dev:chess:local
pnpm dev:main:vps
pnpm dev:chess:vps
```

`config/local.env` sets `VITE_FLUENT_WIDGET_NETWORK=testnet`. For mainnet demos:

```bash
pnpm config:run mainnet -- pnpm --filter app-chess dev --host 0.0.0.0 --port 5173
```

Do not put private keys, deployer secrets, backend signing secrets, or database credentials here. Use real `.env` files or secret managers for those values.
