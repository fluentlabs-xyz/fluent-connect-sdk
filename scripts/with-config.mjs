#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const [, , envName, separator, ...command] = process.argv;

if (!envName || envName === "--help" || envName === "-h") {
  printUsage();
  process.exit(envName ? 0 : 1);
}

if (separator !== "--" || command.length === 0) {
  printUsage();
  process.exit(1);
}

const configPath = resolve(process.cwd(), "config", envName + ".env");
if (!existsSync(configPath)) {
  console.error("Missing config: " + configPath);
  process.exit(1);
}

const nextEnv = {
  ...process.env,
  ...parseEnvFile(readFileSync(configPath, "utf8")),
  FLUENT_CONFIG_ENV: envName,
};

const child = spawn(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: nextEnv,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

function parseEnvFile(source) {
  const parsed = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }
  return parsed;
}

function printUsage() {
  console.log([
    "Usage:",
    "  pnpm config:run <env> -- <command>",
    "",
    "Examples:",
    "  pnpm config:run local -- pnpm --filter mock-fluent-connect-main dev --host 0.0.0.0 --port 5173",
    "  pnpm config:run local -- pnpm --filter app-chess dev --host 0.0.0.0 --port 5173",
  ].join("\n"));
}
