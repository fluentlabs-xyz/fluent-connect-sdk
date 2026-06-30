FROM node:20-alpine

WORKDIR /app

RUN corepack enable
RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY examples/privy-connect ./examples/privy-connect

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fluent/registry build
RUN pnpm --filter @fluent/wallet-sdk build

EXPOSE 5173
CMD ["pnpm", "--filter", "example-privy-connect", "dev", "--host", "0.0.0.0", "--port", "5173"]
