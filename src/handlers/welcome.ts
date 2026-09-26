import type { Context } from "telegraf";
import type { AppConfig } from "../config/env";
import { createLogger, formatError } from "../config/logger";
import { type SeenStore } from "../utils/dedupe";
import { escapeHtml } from "../utils/html";
import { buildMention, buildUsername, displayName } from "../utils/mention";
import { type KeyedQueue } from "../utils/queue";
import { sendMessageWithFallback, scheduleDelete, stripHtml } from "../utils/telegram";
import type { TelegramLike } from "../utils/telegram";
import { renderTemplate, type TemplateVars } from "../utils/template";
import type { UserLike } from "../utils/mention";

const log = createLogger("welcome");

interface ChatLike {
  id: number | string;
  type: string;
  title?: string;
  username?: string;
}

interface NewChatMembersMessage {
  new_chat_members?: UserLike[];
}

export interface WelcomeDeps {
  config: AppConfig;
  seen: SeenStore;
  queue: KeyedQueue;
}

function buildVars(chat: ChatLike, user: UserLike, style: "html" | "text"): TemplateVars {
  const decorate = (value: string): string => (style === "html" ? escapeHtml(value) : value);
  const title = chat.title?.trim() ?? "";

  return {
    mention: buildMention(user, style),
    name: decorate(displayName(user)),
    username: buildUsername(user),
    group: decorate(title === "" ? "this group" : title),
    groupUsername: chat.username ? `@${chat.username}` : "",
  };
}

export function createWelcomeHandler(deps: WelcomeDeps) {
  const { config, seen, queue } = deps;

  return async function handleNewChatMembers(ctx: Context): Promise<void> {
    // Telegram models service messages as a union; narrow it to what we need.
    const message = ctx.message as unknown as NewChatMembersMessage | undefined;
    if (message === undefined) return;

    const members = message.new_chat_members ?? [];
    if (members.length === 0) {
      log.debug("update without new members, ignoring");
      return;
    }

    const chat = ctx.chat as ChatLike | undefined;
    if (chat === undefined) return;

    if (chat.type !== "group" && chat.type !== "supergroup") {
      log.debug("ignoring non-group chat", { type: chat.type });
      return;
    }

    const chatId = Number(chat.id);
    if (!Number.isSafeInteger(chatId)) {
      log.warn("chat id is not numeric, ignoring", { type: chat.type });
      return;
    }

    if (config.welcome.allowChatIds.length > 0 && !config.welcome.allowChatIds.includes(chatId)) {
      log.debug("chat not in ALLOWED_CHAT_IDS, ignoring", { chatId });
      return;
    }

    const eligible = config.welcome.ignoreBots
      ? members.filter((member) => member.is_bot !== true)
      : members;

    const ignoredBots = members.length - eligible.length;
    if (eligible.length === 0) {
      log.debug("no eligible members to welcome", { chatId, ignoredBots });
      return;
    }

    log.info("new member event", {
      chatId,
      chatTitle: chat.title ?? null,
      total: members.length,
      eligible: eligible.length,
      ignoredBots,
    });

    const telegram = ctx.telegram as unknown as TelegramLike;

    for (const member of eligible) {
      const user: UserLike = {
        id: member.id,
        is_bot: member.is_bot,
        first_name: member.first_name,
        last_name: member.last_name,
        username: member.username,
      };

      const selfId = (ctx as { botInfo?: { id: number } }).botInfo?.id;
      if (selfId !== undefined && user.id === selfId) {
        log.debug("member is this bot, skipping", { chatId });
        continue;
      }

      if (!seen.add(`${chatId}:${user.id}`)) {
        log.debug("duplicate welcome suppressed", { chatId, userId: user.id });
        continue;
      }

      const useHtml = config.welcome.parseMode === "HTML";
      const htmlVars = buildVars(chat, user, "html");
      const textVars = buildVars(chat, user, "text");
      const onUnknown = (name: string): void => {
        log.warn("unknown placeholder in WELCOME_TEMPLATE", { placeholder: name });
      };
      const html = renderTemplate(config.welcome.template, htmlVars, onUnknown);
      const text = renderTemplate(config.welcome.template, textVars, onUnknown);
      const plain = stripHtml(text);

      if (config.dryRun) {
        log.info("[DRY RUN] welcome message not sent", {
          chatId,
          userId: user.id,
          hasUsername: Boolean(user.username),
          html,
        });
        continue;
      }

      try {
        await queue.run(String(chatId), async () => {
          const sent = await sendMessageWithFallback(
            {
              telegram,
              onRetry: ({ attempt, waitMs, reason }) => {
                log.warn("telegram send failed, retrying", { attempt, waitMs, reason });
              },
            },
            { chatId, html, text: plain, useHtml, maxRetries: config.welcome.maxRetries },
          );

          if (sent === null) return;

          if (config.welcome.deleteAfterMs !== null) {
            scheduleDelete(telegram, chatId, sent.message_id, config.welcome.deleteAfterMs, log);
          }
        });
      } catch (error) {
        // One failure must never stop the remaining members of the same update.
        log.error("could not send welcome message", {
          chatId,
          userId: user.id,
          error: formatError(error),
        });
      }
    }
  };
}
