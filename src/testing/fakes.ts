import type { Context } from "telegraf";
import type { TelegramLike } from "../utils/telegram";

export interface SentMessage {
  chatId: number;
  text: string;
  extra: Record<string, unknown> | undefined;
}

export interface FakeTelegram extends TelegramLike {
  sent: SentMessage[];
  deleted: Array<{ chatId: number; messageId: number }>;
  failWith: (error: unknown, times?: number) => void;
}

interface FakeUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface FakeChat {
  id: number;
  type: "group" | "supergroup" | "private" | "channel";
  title?: string;
  username?: string;
}

/** In-memory Telegram stub: records sends instead of calling the real API. */
export function createFakeTelegram(): FakeTelegram {
  const sent: SentMessage[] = [];
  const deleted: Array<{ chatId: number; messageId: number }> = [];
  const failures: Array<{ error: unknown; remaining: number }> = [];

  return {
    sent,
    deleted,
    failWith(error: unknown, times = 1): void {
      failures.push({ error, remaining: times });
    },
    async sendMessage(chatId: number, text: string, extra?: Record<string, unknown>) {
      const failure = failures.find((item) => item.remaining > 0);
      if (failure !== undefined) {
        failure.remaining -= 1;
        throw failure.error;
      }
      sent.push({ chatId, text, extra });
      return { message_id: sent.length };
    },
    async deleteMessage(chatId: number, messageId: number) {
      deleted.push({ chatId, messageId });
      return true;
    },
  };
}

export function createJoinContext(options: {
  members: FakeUser[];
  chat?: FakeChat;
  telegram?: FakeTelegram;
  botId?: number;
}): Context {
  const chat: FakeChat = options.chat ?? {
    id: -1001234567890,
    type: "supergroup",
    title: "2Brothers Services",
  };
  const telegram = options.telegram ?? createFakeTelegram();

  return {
    chat,
    message: { new_chat_members: options.members },
    telegram,
    botInfo: { id: options.botId ?? 999 },
  } as unknown as Context;
}

export function createTextContext(options: { text: string; chat?: FakeChat; telegram?: FakeTelegram }): Context {
  const chat: FakeChat = options.chat ?? { id: 42, type: "private" };
  const telegram = options.telegram ?? createFakeTelegram();
  const replies: string[] = [];

  const ctx = {
    chat,
    message: { text: options.text },
    telegram,
    reply: async (text: string) => {
      replies.push(text);
      return { message_id: replies.length };
    },
  } as unknown as Context;

  return ctx;
}

export function telegramApiError(code: number, description: string, retryAfter?: number): Error {
  const error = new Error(`Telegram API error ${code}: ${description}`) as Error & {
    error_code: number;
    parameters?: { retry_after?: number };
  };
  error.error_code = code;
  if (retryAfter !== undefined) error.parameters = { retry_after: retryAfter };
  return error;
}
