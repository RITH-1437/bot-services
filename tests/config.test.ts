import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConfigError,
  describeSafeConfig,
  expandEscapedNewlines,
  loadConfig,
  parseBoolean,
  parseChatIds,
  parseDurationToMs,
  parseLogLevel,
  parsePort,
  parseRunMode,
} from "../src/config/env";
import { redact, registerSecret, createLogger, setLogLevel } from "../src/config/logger";

const TOKEN = "123456789:AAFakeTokenValueForTests_0123456789abcdefGHIJKL";

test("durations accept human units and reject nonsense", () => {
  assert.equal(parseDurationToMs("1h"), 3_600_000);
  assert.equal(parseDurationToMs("5m"), 300_000);
  assert.equal(parseDurationToMs("90s"), 90_000);
  assert.equal(parseDurationToMs("2d"), 172_800_000);
  assert.equal(parseDurationToMs("never"), null);
  assert.equal(parseDurationToMs(""), null);
  assert.equal(parseDurationToMs(undefined), null);
  assert.throws(() => parseDurationToMs("soon"), ConfigError);
});

test("booleans, levels, modes and ports are validated", () => {
  assert.equal(parseBoolean("true", false), true);
  assert.equal(parseBoolean("no", true), false);
  assert.equal(parseBoolean(undefined, true), true);
  assert.throws(() => parseBoolean("maybe", false), ConfigError);

  assert.equal(parseLogLevel("DEBUG"), "debug");
  assert.throws(() => parseLogLevel("loud"), ConfigError);

  assert.equal(parseRunMode(undefined), "polling");
  assert.equal(parseRunMode("webhook"), "webhook");
  assert.throws(() => parseRunMode("both"), ConfigError);

  assert.equal(parsePort(undefined), 3000);
  assert.throws(() => parsePort("70000"), ConfigError);
});

test("chat id list ignores invalid entries but keeps supergroup ids", () => {
  const warnings: string[] = [];
  const ids = parseChatIds("-1001234567890, 42, not-an-id,", (m) => warnings.push(m));
  assert.deepEqual(ids, [-1001234567890, 42]);
  assert.equal(warnings.length, 1);
});

test("escaped newlines in the template become real line breaks", () => {
  assert.equal(expandEscapedNewlines("a\\nb"), "a\nb");
});

test("missing token fails with an actionable message and never leaks a value", () => {
  assert.throws(
    () => loadConfig({ env: {} }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /TELEGRAM_BOT_TOKEN/);
      return true;
    },
  );
});

test("loadConfig applies defaults, template and delete window", () => {
  const config = loadConfig({
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      WELCOME_TEMPLATE: "Hi {{mention}}\\nWelcome!",
      WELCOME_DELETE_AFTER: "1h",
      IGNORE_BOTS: "false",
    },
  });

  assert.equal(config.token, TOKEN);
  assert.equal(config.mode, "polling");
  assert.equal(config.welcome.ignoreBots, false);
  assert.equal(config.welcome.deleteAfterMs, 3_600_000);
  assert.equal(config.welcome.template, "Hi {{mention}}\nWelcome!");
  assert.deepEqual(config.welcome.allowChatIds, []);
  assert.equal(config.welcome.parseMode, "HTML");
});

test("webhook mode requires an https domain", () => {
  assert.throws(
    () => loadConfig({ env: { TELEGRAM_BOT_TOKEN: TOKEN, RUN_MODE: "webhook" } }),
    /WEBHOOK_DOMAIN/,
  );
  assert.throws(
    () =>
      loadConfig({
        env: { TELEGRAM_BOT_TOKEN: TOKEN, RUN_MODE: "webhook", WEBHOOK_DOMAIN: "http://bot.example.com" },
      }),
    /https/,
  );

  const config = loadConfig({
    env: {
      TELEGRAM_BOT_TOKEN: TOKEN,
      RUN_MODE: "webhook",
      WEBHOOK_DOMAIN: "https://bot.example.com/",
      WEBHOOK_SECRET: "s3cret",
    },
  });
  assert.equal(config.http.webhookDomain, "https://bot.example.com");
  assert.equal(config.http.webhookSecret, "s3cret");
});

test("safe config summary never contains the token", () => {
  const config = loadConfig({ env: { TELEGRAM_BOT_TOKEN: TOKEN } });
  const summary = JSON.stringify(describeSafeConfig(config));
  assert.ok(!summary.includes(TOKEN));
  assert.match(summary, /"tokenConfigured":true/);
});

test("logger redacts registered secrets and token-shaped strings", () => {
  registerSecret(TOKEN);
  assert.ok(!redact(`calling https://api.telegram.org/bot${TOKEN}/getMe`).includes(TOKEN));
  assert.ok(redact("token: hunter2").includes("REDACTED"));
  assert.ok(redact("secret_token=abcdef123456").includes("REDACTED"));
  assert.ok(redact("bot987654321:AAHfqkfjhfkjsdhfkjsdhfkjsdhfk").includes("REDACTED"));
  assert.equal(redact("nothing to hide here"), "nothing to hide here");
});

test("nothing written to stdout contains the token", () => {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    written.push(chunk);
    return true;
  };
  setLogLevel("debug");
  try {
    const log = createLogger("bot").child("welcome");
    log.info("sending message", { url: `https://api.telegram.org/bot${TOKEN}/sendMessage` });
    log.debug("token in text: " + TOKEN);
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
    setLogLevel("info");
  }
  const output = written.join("");
  assert.match(output, /\[bot:welcome\]/);
  assert.ok(!output.includes(TOKEN), "token leaked into the logs");
});

test("child loggers add a scope suffix", () => {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    written.push(chunk);
    return true;
  };
  setLogLevel("debug");
  try {
    createLogger("bot").child("welcome").info("hello");
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
    setLogLevel("info");
  }
  assert.match(written.join(""), /\[bot:welcome\]/);
});
