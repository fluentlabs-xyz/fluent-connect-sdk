FROM node:20-alpine

WORKDIR /app

RUN corepack enable
RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY mocks/fluent-connect-main ./mocks/fluent-connect-main

RUN pnpm install --frozen-lockfile

EXPOSE 5173
CMD ["pnpm", "--filter", "mock-fluent-connect-main", "dev", "--host", "0.0.0.0", "--port", "5173"]
