import { randomBytes } from "node:crypto";
import { Telegraf } from "telegraf";
import { ConfigError, describeSafeConfig, loadConfig, type AppConfig } from "./config/env";
import { createLogger, formatError, registerSecret, setLogLevel } from "./config/logger";
import { registerCommands } from "./handlers/commands";
import { createWelcomeHandler } from "./handlers/welcome";
import { createHttpServer } from "./server";
import { SeenStore } from "./utils/dedupe";
import { KeyedQueue } from "./utils/queue";
import { defaultSleep, isFatalAuthError } from "./utils/telegram";

const log = createLogger("main");

class FatalError extends Error {}

async function runPolling(bot: Telegraf): Promise<void> {
  let attempt = 0;

  for (;;) {
    try {
      await bot.launch({
        // Old join events from a previous downtime are dropped on purpose:
        // replaying them would spam the group with stale welcomes.
        dropPendingUpdates: true,
        allowedUpdates: ["message"],
      });
      log.info("long polling stopped");
      return;
    } catch (error) {
      if (isFatalAuthError(error)) {
        throw new FatalError(
          "Telegram rejected TELEGRAM_BOT_TOKEN. Check the token in @BotFather and in your environment.",
        );
      }
      attempt += 1;
      const waitMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
      log.error("long polling failed, retrying", { attempt, waitMs, error: formatError(error) });
      await defaultSleep(waitMs);
    }
  }
}

async function runWebhookMode(bot: Telegraf, config: AppConfig): Promise<() => Promise<void>> {
  const domain = config.http.webhookDomain;
  if (domain === null) {
    throw new ConfigError("RUN_MODE=webhook requires WEBHOOK_DOMAIN.");
  }

  let secret = config.http.webhookSecret;
  if (secret === null) {
    secret = randomBytes(24).toString("hex");
    log.warn("WEBHOOK_SECRET not set: using an ephemeral secret for this process only");
  }
  registerSecret(secret);

  await bot.telegram.setWebhook(`${domain}${config.http.webhookPath}`, {
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  log.info("webhook registered", { url: `${domain}${config.http.webhookPath}` });

  const handle = createHttpServer(bot, { ...config.http, webhookSecret: secret });
  await handle.start();

  return async () => {
    await handle.stop();
    try {
      await bot.telegram.deleteWebhook();
      log.info("webhook removed");
    } catch (error) {
      log.warn("could not remove webhook", { error: formatError(error) });
    }
  };
}

function installProcessHandlers(stop: () => Promise<void>): void {
  let shuttingDown = false;

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, shutting down`);
    void stop()
      .catch((error: unknown) => {
        log.error("error during shutdown", { error: formatError(error) });
      })
      .finally(() => {
        process.exit(0);
      });
  };

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  // A malformed update must never take the bot offline: log and keep serving.
  process.on("uncaughtException", (error) => {
    log.error("uncaught exception, process kept alive", { error: formatError(error) });
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandled rejection, process kept alive", { error: formatError(reason) });
  });
}

async function main(): Promise<void> {
  const config = loadConfig({ onWarn: (message) => log.warn(message) });
  setLogLevel(config.logLevel);
  registerSecret(config.token);

  if (process.env.DEBUG !== undefined && process.env.DEBUG !== "") {
    log.warn("DEBUG is set: Telegraf's own debug output is not redacted, unset it in production");
  }

  const bot = new Telegraf(config.token);
  // Avoid an extra getMe round-trip inside launch().
  bot.botInfo = await bot.telegram.getMe();

  bot.catch((error, ctx) => {
    log.error("update error", {
      chatId: ctx.chat?.id,
      error: formatError(error),
    });
  });

  const seen = new SeenStore(config.welcome.duplicateWindowMs);
  const queue = new KeyedQueue();
  bot.on("new_chat_members", createWelcomeHandler({ config, seen, queue }));
  registerCommands(bot, config);

  log.info("starting", describeSafeConfig(config));

  if (config.dryRun) {
    log.warn("DRY_RUN is enabled: no message will ever be sent to Telegram");
  }

  log.info("bot identity confirmed", { username: bot.botInfo.username });

  if (config.mode === "webhook") {
    const stopWebhook = await runWebhookMode(bot, config);
    installProcessHandlers(async () => {
      await stopWebhook();
      await bot.stop();
    });
    return;
  }

  installProcessHandlers(async () => {
    await bot.stop();
  });
  await runPolling(bot);
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError || error instanceof FatalError ? error.message : formatError(error);
  log.error("bot stopped", { error: message });
  process.exitCode = 1;
});
