FROM node:20-alpine

WORKDIR /app

RUN corepack enable
RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/chess ./apps/chess

RUN pnpm install --frozen-lockfile

EXPOSE 8050
CMD ["pnpm", "--filter", "app-chess", "dev", "--host", "0.0.0.0", "--port", "8050"]
