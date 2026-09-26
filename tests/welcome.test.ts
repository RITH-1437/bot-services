import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, type AppConfig } from "../src/config/env";
import { createWelcomeHandler } from "../src/handlers/welcome";
import { SeenStore } from "../src/utils/dedupe";
import { KeyedQueue } from "../src/utils/queue";
import { createFakeTelegram, createJoinContext, telegramApiError } from "../src/testing/fakes";
import type { Context } from "telegraf";

const TEMPLATE =
  "👋 Welcome {{mention}} to {{group}}! 🚀\n\nWe're happy to have you here!\n\n🌐 https://2brothers-services.vercel.app/";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    requireToken: false,
    env: { WELCOME_TEMPLATE: TEMPLATE.replace(/\n/g, "\\n") },
  });
  base.token = "test-token";
  return {
    ...base,
    ...overrides,
    welcome: { ...base.welcome, ...(overrides.welcome ?? {}) },
  };
}

function makeHandler(config: AppConfig) {
  return createWelcomeHandler({
    config,
    seen: new SeenStore(config.welcome.duplicateWindowMs),
    queue: new KeyedQueue(),
  });
}

test("welcome message is posted in the group with an @username mention", async () => {
  const config = makeConfig({ token: "t", dryRun: false });
  const telegram = createFakeTelegram();
  const ctx = createJoinContext({
    members: [{ id: 1, first_name: "Ada", username: "ada" }],
    telegram,
  });

  await makeHandler(config)(ctx);

  assert.equal(telegram.sent.length, 1);
  const sent = telegram.sent[0];
  assert.ok(sent);
  assert.equal(sent.chatId, -1001234567890);
  assert.equal(sent.extra?.parse_mode, "HTML");
  assert.match(sent.text, /Welcome @ada to 2Brothers Services/);
  assert.match(sent.text, /https:\/\/2brothers-services\.vercel\.app\//);
});

test("member without a username gets a safe mention without exposing the id", async () => {
  const config = makeConfig();
  const telegram = createFakeTelegram();

  await makeHandler(config)(
    createJoinContext({ members: [{ id: 987654321, first_name: "Grace", last_name: "Hopper" }], telegram }),
  );

  const sent = telegram.sent[0];
  assert.ok(sent);
  assert.match(sent.text, /<a href="tg:\/\/user\?id=987654321">Grace Hopper<\/a>/);
  const visible = sent.text.replace(/<a href="[^"]*">/g, "").replace(/<\/a>/g, "");
  assert.doesNotMatch(visible, /987654321/);
});

test("several members in one update are all welcomed, bots are skipped", async () => {
  const config = makeConfig({ welcome: { ...makeConfig().welcome, ignoreBots: true } });
  const telegram = createFakeTelegram();

  await makeHandler(config)(
    createJoinContext({
      members: [
        { id: 10, first_name: "Alan", username: "alan" },
        { id: 11, first_name: "Helper", username: "helper_bot", is_bot: true },
        { id: 12, first_name: "Katherine" },
      ],
      telegram,
    }),
  );

  assert.equal(telegram.sent.length, 2);
  assert.match(telegram.sent[0]?.text ?? "", /@alan/);
  assert.doesNotMatch(telegram.sent[0]?.text ?? "", /helper_bot/);
  assert.match(telegram.sent[1]?.text ?? "", /Katherine/);
});

test("bots are welcomed when IGNORE_BOTS is false", async () => {
  const config = makeConfig();
  config.welcome.ignoreBots = false;
  const telegram = createFakeTelegram();

  await makeHandler(config)(
    createJoinContext({ members: [{ id: 13, username: "some_bot", is_bot: true }], telegram }),
  );

  assert.equal(telegram.sent.length, 1);
});

test("the bot never welcomes itself", async () => {
  const config = makeConfig();
  const telegram = createFakeTelegram();

  await makeHandler(config)(
    createJoinContext({ members: [{ id: 999, first_name: "Welcome Bot", is_bot: false }], telegram, botId: 999 }),
  );

  assert.equal(telegram.sent.length, 0);
});

test("duplicate joins are suppressed inside the window", async () => {
  const config = makeConfig();
  const handler = makeHandler(config);
  const members = [{ id: 20, first_name: "Ada", username: "ada" }];

  await handler(createJoinContext({ members, telegram: createFakeTelegram() }));
  await handler(createJoinContext({ members, telegram: createFakeTelegram() }));

  const telegram = createFakeTelegram();
  await handler(createJoinContext({ members, telegram }));
  assert.equal(telegram.sent.length, 0);
});

test("ALLOWED_CHAT_IDS restricts which groups are welcomed", async () => {
  const config = makeConfig();
  config.welcome.allowChatIds = [-100999];
  const telegram = createFakeTelegram();

  await makeHandler(config)(
    createJoinContext({ members: [{ id: 30, username: "ada" }], telegram }),
  );

  assert.equal(telegram.sent.length, 0);
});

test("private chats and channels are ignored", async () => {
  const config = makeConfig();

  for (const type of ["private", "channel"] as const) {
    const telegram = createFakeTelegram();
    await makeHandler(config)(
      createJoinContext({ members: [{ id: 40, username: "ada" }], telegram, chat: { id: 5, type } }),
    );
    assert.equal(telegram.sent.length, 0);
  }
});

test("an update without new members does nothing", async () => {
  const config = makeConfig();
  const telegram = createFakeTelegram();
  const ctx = { chat: { id: 1, type: "supergroup" }, message: {}, telegram } as unknown as Context;

  await makeHandler(config)(ctx);

  assert.equal(telegram.sent.length, 0);
});

test("DRY_RUN renders the message without sending anything", async () => {
  const config = makeConfig({ dryRun: true });
  const telegram = createFakeTelegram();

  await makeHandler(config)(
    createJoinContext({ members: [{ id: 50, first_name: "Ada", username: "ada" }], telegram }),
  );

  assert.equal(telegram.sent.length, 0);
});

test("Telegram API errors do not break the handler or the other members", async () => {
  const config = makeConfig();
  const telegram = createFakeTelegram();
  telegram.failWith(telegramApiError(400, "Bad Request: chat not found"), 5);

  await makeHandler(config)(
    createJoinContext({
      members: [
        { id: 60, username: "first" },
        { id: 61, username: "second" },
      ],
      telegram,
    }),
  );

  assert.equal(telegram.sent.length, 0);
});

test("a failing member does not stop the next member of the same update", async () => {
  const config = makeConfig();
  const telegram = createFakeTelegram();
  telegram.failWith(telegramApiError(400, "Bad Request: can't parse entities"), 1);

  await makeHandler(config)(
    createJoinContext({
      members: [
        { id: 70, first_name: "Broken<" },
        { id: 71, first_name: "Fine", username: "fine" },
      ],
      telegram,
    }),
  );

  assert.ok(telegram.sent.length >= 1);
  assert.match(telegram.sent[telegram.sent.length - 1]?.text ?? "", /@fine/);
});

test("welcome messages are deleted after the configured delay", async () => {
  const config = makeConfig();
  config.welcome.deleteAfterMs = 5;
  const telegram = createFakeTelegram();

  await makeHandler(config)(
    createJoinContext({ members: [{ id: 80, username: "ada" }], telegram }),
  );

  assert.equal(telegram.sent.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(telegram.deleted.length, 1);
  assert.equal(telegram.deleted[0]?.messageId, 1);
});

test("no deletion is scheduled when the delay is disabled", async () => {
  const config = makeConfig();
  config.welcome.deleteAfterMs = null;
  const telegram = createFakeTelegram();

  await makeHandler(config)(
    createJoinContext({ members: [{ id: 90, username: "ada" }], telegram }),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(telegram.deleted.length, 0);
});

test("plain-text mode sends no HTML entities", async () => {
  const config = makeConfig();
  config.welcome.parseMode = "none";
  const telegram = createFakeTelegram();

  await makeHandler(config)(createJoinContext({ members: [{ id: 100, first_name: "No User" }], telegram }));

  const sent = telegram.sent[0];
  assert.ok(sent);
  assert.equal(sent.extra?.parse_mode, undefined);
  assert.doesNotMatch(sent.text, /<a href/);
  assert.match(sent.text, /Welcome No User/);
});
