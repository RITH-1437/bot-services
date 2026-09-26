import type { LogLevel } from "./env";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED = "***REDACTED***";

/** Literal secret values (token, webhook secret) registered at startup. */
const secretValues = new Set<string>();

/** Generic patterns so a leaked token is masked even if it was never registered. */
const TOKEN_IN_URL = /bot\d{4,}:[A-Za-z0-9_-]{5,}/g;
const SECRET_KEY_VALUE =
  /\b(secret_token|telegram_bot_token|bot_token|access_token|authorization|token)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;

export function registerSecret(value: string | undefined | null): void {
  if (typeof value === "string" && value.trim().length >= 5) {
    secretValues.add(value.trim());
  }
}

/** Removes secrets from any string before it reaches stdout/stderr. */
export function redact(input: string): string {
  let output = input;
  for (const secret of secretValues) {
    if (secret !== "" && output.includes(secret)) {
      output = output.split(secret).join(REDACTED);
    }
  }
  output = output.replace(TOKEN_IN_URL, `bot${REDACTED}`);
  output = output.replace(SECRET_KEY_VALUE, (_match, key: string, separator: string) => {
    return `${key}${separator}${REDACTED}`;
  });
  return output;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) return redact(formatError(value));
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactValue(item);
    }
    return output;
  }
  return value;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    const cause = error.cause instanceof Error ? ` | cause: ${error.cause.message}` : "";
    return `${error.name}: ${error.message}${code === undefined ? "" : ` (${code})`}${cause}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
}

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function write(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const head = `${timestamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${redact(message)}`;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (meta === undefined) {
    stream.write(`${head}\n`);
    return;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(redactValue(meta));
  } catch {
    serialized = '"[unserializable metadata]"';
  }
  stream.write(`${head} ${serialized}\n`);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => write("debug", scope, message, meta),
    info: (message, meta) => write("info", scope, message, meta),
    warn: (message, meta) => write("warn", scope, message, meta),
    error: (message, meta) => write("error", scope, message, meta),
    child: (childScope: string) => createLogger(`${scope}:${childScope}`),
  };
}

export const logger = createLogger("bot");
