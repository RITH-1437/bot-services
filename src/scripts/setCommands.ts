import { Telegraf } from "telegraf";
import { loadConfig } from "../config/env";
import { createLogger, formatError, registerSecret } from "../config/logger";

const log = createLogger("set-commands");

const COMMANDS = [
  { command: "start", description: "Start the bot" },
  { command: "help", description: "Show the available commands" },
  { command: "about", description: "What this bot does" },
];

/** Registers /start, /help and /about so clients show them in the UI. */
async function main(): Promise<void> {
  const config = loadConfig({ onWarn: (message) => log.warn(message) });
  registerSecret(config.token);

  const bot = new Telegraf(config.token);
  const info = await bot.telegram.getMe();
  await bot.telegram.setMyCommands(COMMANDS);
  log.info("commands registered", { bot: info.username, commands: COMMANDS.map((c) => c.command) });
}

main().catch((error: unknown) => {
  log.error("could not register commands", { error: formatError(error) });
  process.exitCode = 1;
});
