import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

export type LogLevel = "debug" | "info" | "warn" | "error";
export type RunMode = "polling" | "webhook";
export type WelcomeParseMode = "HTML" | "none";

/**
 * Generic fallback template. The real message lives in WELCOME_TEMPLATE (.env)
 * so it can be changed without touching the code.
 */
export const DEFAULT_WELCOME_TEMPLATE = "👋 Welcome {{mention}} to {{group}}! 🎉";

export interface WelcomeConfig {
  /** Template with {{placeholders}}. Literal "\n" sequences are converted to newlines. */
  template: string;
  parseMode: WelcomeParseMode;
  ignoreBots: boolean;
  /** Auto-delete the welcome message after N ms. null = never delete. */
  deleteAfterMs: number | null;
  /** A user joining twice inside this window is welcomed only once. */
  duplicateWindowMs: number;
  maxRetries: number;
  /** Empty = every group the bot is a member of. */
  allowChatIds: number[];
}

export interface HttpConfig {
  port: number;
  webhookDomain: string | null;
  webhookPath: string;
  webhookSecret: string | null;
  healthPath: string;
}

export interface AppConfig {
  token: string;
  logLevel: LogLevel;
  mode: RunMode;
  dryRun: boolean;
  siteUrl: string;
  welcome: WelcomeConfig;
  http: HttpConfig;
}

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const NEVER_VALUES = new Set(["", "never", "off", "no", "none", "false", "0", "disabled"]);
const TRUTHY = new Set(["1", "true", "yes", "y", "on", "enable", "enabled"]);
const FALSY = new Set(["0", "false", "no", "n", "off", "disable", "disabled"]);

/** Parses "1h", "90m", "45s", "2d", "never", "" -> milliseconds or null. */
export function parseDurationToMs(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const value = raw.trim().toLowerCase();
  if (NEVER_VALUES.has(value)) return null;

  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(value);
  if (!match) {
    throw new ConfigError(
      `Invalid duration "${raw}". Use a value like 30s, 10m, 1h, 2d, or "never".`,
    );
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multiplier = DURATION_UNITS[unit];
  if (multiplier === undefined) {
    throw new ConfigError(`Invalid duration unit "${unit}" in "${raw}".`);
  }
  return Math.round(amount * multiplier);
}

export function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (TRUTHY.has(value)) return true;
  if (FALSY.has(value)) return false;
  throw new ConfigError(`Invalid boolean "${raw}". Use true or false.`);
}

export function parseLogLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? "info").trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  throw new ConfigError(`Invalid LOG_LEVEL "${raw}". Use debug, info, warn or error.`);
}

export function parseRunMode(raw: string | undefined): RunMode {
  const value = (raw ?? "polling").trim().toLowerCase();
  if (value === "polling" || value === "webhook") return value;
  throw new ConfigError(`Invalid RUN_MODE "${raw}". Use "polling" or "webhook".`);
}

export function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 3000;
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(`Invalid PORT "${raw}". Use an integer between 1 and 65535.`);
  }
  return port;
}

export function parseChatIds(raw: string | undefined, warn: (message: string) => void): number[] {
  if (raw === undefined || raw.trim() === "") return [];
  const ids: number[] = [];
  for (const part of raw.split(",")) {
    const candidate = part.trim();
    if (candidate === "") continue;
    const id = Number(candidate);
    if (!Number.isSafeInteger(id)) {
      warn(`ALLOWED_CHAT_IDS: ignoring "${candidate}" (not a numeric chat id).`);
      continue;
    }
    ids.push(id);
  }
  return ids;
}

/** `.env` files cannot hold real line breaks safely everywhere, so "\n" is expanded. */
export function expandEscapedNewlines(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export interface LoadConfigOptions {
  requireToken?: boolean;
  env?: NodeJS.ProcessEnv;
  onWarn?: (message: string) => void;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const { requireToken = true, env = process.env } = options;
  const warn = options.onWarn ?? ((): void => {});

  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (requireToken && token === "") {
    throw new ConfigError(
      "TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and paste the token from @BotFather.",
    );
  }

  const parseModeRaw = (env.WELCOME_PARSE_MODE ?? "HTML").trim().toLowerCase();
  if (parseModeRaw !== "html" && parseModeRaw !== "none") {
    throw new ConfigError(`Invalid WELCOME_PARSE_MODE "${env.WELCOME_PARSE_MODE}". Use HTML or none.`);
  }

  const template = expandEscapedNewlines(
    (env.WELCOME_TEMPLATE ?? "").trim() === ""
      ? DEFAULT_WELCOME_TEMPLATE
      : (env.WELCOME_TEMPLATE as string),
  );

  const mode = parseRunMode(env.RUN_MODE);
  const webhookDomain = (env.WEBHOOK_DOMAIN ?? "").trim().replace(/\/+$/, "");
  const webhookSecret = (env.WEBHOOK_SECRET ?? "").trim();

  if (mode === "webhook") {
    if (webhookDomain === "") {
      throw new ConfigError("RUN_MODE=webhook requires WEBHOOK_DOMAIN (e.g. https://bot.example.com).");
    }
    if (!webhookDomain.startsWith("https://")) {
      throw new ConfigError("WEBHOOK_DOMAIN must start with https:// (Telegram requires HTTPS).");
    }
  }

  const maxRetriesRaw = Number((env.MAX_RETRIES ?? "3").trim());
  if (!Number.isInteger(maxRetriesRaw) || maxRetriesRaw < 0 || maxRetriesRaw > 10) {
    throw new ConfigError(`Invalid MAX_RETRIES "${env.MAX_RETRIES}". Use an integer between 0 and 10.`);
  }

  const duplicateWindowMs = parseDurationToMs(env.WELCOME_DUPLICATE_WINDOW ?? "10m") ?? 600_000;
  const deleteAfterMs = parseDurationToMs(env.WELCOME_DELETE_AFTER);

  const config: AppConfig = {
    token,
    logLevel: parseLogLevel(env.LOG_LEVEL),
    mode,
    dryRun: parseBoolean(env.DRY_RUN, false),
    siteUrl: (env.SITE_URL ?? "https://2brothers-services.vercel.app/").trim(),
    welcome: {
      template,
      parseMode: parseModeRaw === "html" ? "HTML" : "none",
      ignoreBots: parseBoolean(env.IGNORE_BOTS, true),
      deleteAfterMs,
      duplicateWindowMs,
      maxRetries: maxRetriesRaw,
      allowChatIds: parseChatIds(env.ALLOWED_CHAT_IDS, warn),
    },
    http: {
      port: parsePort(env.PORT),
      webhookDomain: webhookDomain === "" ? null : webhookDomain,
      webhookPath: env.WEBHOOK_PATH?.trim() || "/webhook",
      webhookSecret: webhookSecret === "" ? null : webhookSecret,
      healthPath: env.HEALTH_PATH?.trim() || "/health",
    },
  };

  return config;
}

/** Startup log payload. Must never contain the token. */
export function describeSafeConfig(config: AppConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    dryRun: config.dryRun,
    parseMode: config.welcome.parseMode,
    ignoreBots: config.welcome.ignoreBots,
    deleteAfter: config.welcome.deleteAfterMs === null ? "never" : `${config.welcome.deleteAfterMs}ms`,
    duplicateWindowMs: config.welcome.duplicateWindowMs,
    maxRetries: config.welcome.maxRetries,
    allowedChatIds:
      config.welcome.allowChatIds.length === 0 ? "all groups" : config.welcome.allowChatIds,
    port: config.mode === "webhook" ? config.http.port : undefined,
    tokenConfigured: config.token !== "",
  };
}
