import { formatError } from "../config/logger";
import { stripHtml } from "./html";

/** Minimal Telegram surface used by this bot; keeps the handlers testable. */
export interface TelegramLike {
  sendMessage(
    chatId: number,
    text: string,
    extra?: Record<string, unknown>,
  ): Promise<{ message_id: number }>;
  deleteMessage(chatId: number, messageId: number): Promise<unknown>;
}

export interface SendOptions {
  chatId: number;
  /** Preferred message body (HTML). */
  html: string;
  /** Plain-text body used when the HTML body cannot be parsed. */
  text: string;
  useHtml: boolean;
  maxRetries: number;
}

export interface SendDeps {
  telegram: TelegramLike;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
  maxRetryAfterMs?: number;
}

const RETRYABLE_SYSTEM_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
]);

const MAX_RETRY_AFTER_MS = 60_000;
const BASE_BACKOFF_MS = 500;

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function getErrorCode(error: unknown): number | undefined {
  const code = asRecord(error)?.error_code;
  return typeof code === "number" ? code : undefined;
}

export function getRetryAfterMs(error: unknown): number | undefined {
  const parameters = asRecord(asRecord(error)?.parameters);
  const retryAfter = parameters?.retry_after;
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
    return Math.max(0, retryAfter * 1_000);
  }
  return undefined;
}

export function isFatalAuthError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === 401 || code === 404;
}

/** True when Telegram refused the HTML entities of the message. */
export function isParseEntityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /can't parse entities|can't parse message text|unsupported start tag|ENTITY_BOUND/i.test(
    message,
  );
}

export function isRetryableError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code === 429) return true;
  if (code !== undefined && code >= 500) return true;
  const systemCode = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof systemCode === "string" && RETRYABLE_SYSTEM_CODES.has(systemCode)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /socket hang up|network|ETIMEDOUT|fetch failed/i.test(message);
}

/**
 * Sends a message, retrying rate limits and transient network/API failures,
 * and falling back to plain text when Telegram cannot parse the HTML body.
 * Returns the message id, or null when every attempt failed.
 */
export async function sendMessageWithFallback(
  deps: SendDeps,
  options: SendOptions,
): Promise<{ message_id: number } | null> {
  const sleep = deps.sleep ?? defaultSleep;
  const maxRetryAfter = deps.maxRetryAfterMs ?? MAX_RETRY_AFTER_MS;
  const bodies: Array<{ body: string; html: boolean }> =
    options.useHtml && options.html !== options.text
      ? [
          { body: options.html, html: true },
          { body: options.text, html: false },
        ]
      : [{ body: options.useHtml ? options.html : options.text, html: options.useHtml }];

  let lastError: unknown;

  for (const candidate of bodies) {
    for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
      try {
        return await deps.telegram.sendMessage(options.chatId, candidate.body, {
          ...(candidate.html ? { parse_mode: "HTML" } : {}),
          link_preview_options: { is_disabled: true },
          disable_web_page_preview: true,
        });
      } catch (error) {
        lastError = error;

        if (candidate.html && isParseEntityError(error)) {
          break; // switch to the plain-text body
        }
        if (!isRetryableError(error) || attempt === options.maxRetries) {
          throw error;
        }

        const retryAfter = getRetryAfterMs(error);
        const waitMs = Math.min(
          retryAfter ?? BASE_BACKOFF_MS * 2 ** attempt,
          maxRetryAfter,
        );
        deps.onRetry?.({
          attempt: attempt + 1,
          waitMs,
          reason: formatError(error),
        });
        await sleep(waitMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Deletes a message later. Safe to call with null when deletion is disabled. */
export function scheduleDelete(
  telegram: TelegramLike,
  chatId: number,
  messageId: number,
  delayMs: number,
  log: { info: (message: string, meta?: unknown) => void; warn: (message: string, meta?: unknown) => void },
): void {
  const timer = setTimeout(() => {
    telegram
      .deleteMessage(chatId, messageId)
      .then(() => {
        log.info("welcome message deleted", { chatId, messageId });
      })
      .catch((error: unknown) => {
        log.warn("could not delete welcome message", {
          chatId,
          messageId,
          error: formatError(error),
        });
      });
  }, delayMs);

  // Never keep the process alive just for a pending deletion.
  timer.unref();
}

export { stripHtml };
