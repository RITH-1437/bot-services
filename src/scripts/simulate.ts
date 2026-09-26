import { loadConfig } from "../config/env";
import { createLogger, setLogLevel } from "../config/logger";
import { createWelcomeHandler } from "../handlers/welcome";
import { SeenStore } from "../utils/dedupe";
import { KeyedQueue } from "../utils/queue";
import { createFakeTelegram, createJoinContext, telegramApiError } from "../testing/fakes";

/**
 * Local, offline smoke test: runs the real welcome handler against a fake
 * Telegram API, so nothing is ever sent to your real chat.
 *
 *   npm run simulate
 */
async function main(): Promise<void> {
  const config = loadConfig({ requireToken: false, onWarn: (m) => log.warn(m) });
  setLogLevel("debug");
  config.dryRun = false; // exercise the real send path against the fake API
  if (config.welcome.deleteAfterMs !== null) {
    config.welcome.deleteAfterMs = 20; // keep the script short
  }

  const scenarios: Array<{ title: string; members: Array<Record<string, unknown>>; chat?: Record<string, unknown> }> = [
    {
      title: "member with a username",
      members: [{ id: 101, first_name: "Ada", last_name: "Lovelace", username: "ada" }],
    },
    {
      title: "member without a username (safe HTML mention)",
      members: [{ id: 102, first_name: "Grace <b>Hopper</b>" }],
    },
    {
      title: "several members at once + one bot",
      members: [
        { id: 103, first_name: "Alan", username: "alan_turing" },
        { id: 104, first_name: "Bot", username: "some_helper_bot", is_bot: true },
        { id: 105, first_name: "Katherine", last_name: "Johnson" },
      ],
    },
  ];

  for (const scenario of scenarios) {
    log.info(`--- scenario: ${scenario.title} ---`);
    const telegram = createFakeTelegram();
    const handler = createWelcomeHandler({
      config,
      seen: new SeenStore(config.welcome.duplicateWindowMs),
      queue: new KeyedQueue(),
    });
    const ctx = createJoinContext({
      members: scenario.members as never,
      chat: scenario.chat as never,
      telegram,
    });

    await handler(ctx);

    for (const message of telegram.sent) {
      const preview = message.text.replace(/\n/g, "\n    ");
      log.info(`chat ${message.chatId} received:\n    ${preview}`);
    }
    if (telegram.sent.length === 0) {
      log.info("no message produced (all members filtered out)");
    }
  }

  log.info("--- scenario: Telegram API error must not crash the handler ---");
  const telegram = createFakeTelegram();
  telegram.failWith(telegramApiError(400, "Bad Request: chat not found"), 1);
  const handler = createWelcomeHandler({
    config,
    seen: new SeenStore(config.welcome.duplicateWindowMs),
    queue: new KeyedQueue(),
  });
  await handler(
    createJoinContext({ members: [{ id: 201, first_name: "Linus", username: "torvalds" }], telegram }),
  );
  log.info("handler survived the API error", { sends: telegram.sent.length });

  log.info("simulation finished (nothing was sent to Telegram)");
}

const log = createLogger("simulate");

main().catch((error: unknown) => {
  log.error("simulation failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
