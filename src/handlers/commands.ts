import type { Context, Telegraf } from "telegraf";
import type { AppConfig } from "../config/env";
import { createLogger } from "../config/logger";

const log = createLogger("commands");

const PRIVATE_HELP = [
  "👋 <b>2Brothers Services Welcome Bot</b>",
  "",
  "I welcome new members in the groups where I am added.",
  "",
  "<b>Commands</b>",
  "/start — show this message",
  "/help — show this message",
  "/about — what this bot does",
].join("\n");

const GROUP_REPLY = "Hi! I am the group welcome bot. Send /help if you need anything.";
const ABOUT_TEXT = [
  "🤖 <b>2Brothers Services Welcome Bot</b>",
  "",
  "Posts a welcome message when new members join a group.",
  "",
  "💻 Web • Systems • Data • Cloud",
  "🌐 {{site}}",
].join("\n");

function isGroup(ctx: Context): boolean {
  const type = ctx.chat?.type;
  return type === "group" || type === "supergroup";
}

export function registerCommands(bot: Telegraf, config: AppConfig): void {
  const onCommand = (name: string) => async (ctx: Context): Promise<void> => {
    try {
      if (isGroup(ctx)) {
        await ctx.reply(GROUP_REPLY);
        return;
      }
      if (name === "about") {
        await ctx.reply(ABOUT_TEXT.replace("{{site}}", config.siteUrl), { parse_mode: "HTML" });
        return;
      }
      await ctx.reply(PRIVATE_HELP, { parse_mode: "HTML" });
    } catch (error) {
      log.error(`/${name} failed`, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  bot.command("start", onCommand("start"));
  bot.command("help", onCommand("help"));
  bot.command("about", onCommand("about"));
}
