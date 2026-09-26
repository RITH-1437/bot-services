import assert from "node:assert/strict";
import { test } from "node:test";
import { SeenStore } from "../src/utils/dedupe";
import { KeyedQueue } from "../src/utils/queue";
import {
  getRetryAfterMs,
  isFatalAuthError,
  isParseEntityError,
  isRetryableError,
  sendMessageWithFallback,
} from "../src/utils/telegram";
import { createFakeTelegram, telegramApiError } from "../src/testing/fakes";

test("SeenStore allows a key once inside the window", () => {
  const store = new SeenStore(1_000);
  assert.equal(store.add("a"), true);
  assert.equal(store.add("a"), false);
  assert.equal(store.has("a"), true);
});

test("SeenStore forgets keys after the ttl and caps its size", () => {
  const store = new SeenStore(1_000, 2);
  store.add("a", 0);
  assert.equal(store.add("a", 1_500), true, "expired entries are dropped");

  const capped = new SeenStore(60_000, 2);
  capped.add("1");
  capped.add("2");
  capped.add("3");
  assert.equal(capped.size, 2);
});

test("KeyedQueue runs tasks for one key sequentially", async () => {
  const queue = new KeyedQueue();
  const order: string[] = [];

  const slow = queue.run("chat", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("first");
  });
  const fast = queue.run("chat", async () => {
    order.push("second");
  });

  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["first", "second"]);
  assert.equal(queue.pending, 0);
});

test("KeyedQueue continues after a rejected task", async () => {
  const queue = new KeyedQueue();
  await assert.rejects(queue.run("chat", async () => Promise.reject(new Error("boom"))));
  assert.equal(await queue.run("chat", async () => "ok"), "ok");
});

test("error classification", () => {
  assert.equal(isRetryableError(telegramApiError(429, "Too Many Requests")), true);
  assert.equal(isRetryableError(telegramApiError(500, "Internal Server Error")), true);
  assert.equal(isRetryableError(telegramApiError(400, "Bad Request: chat not found")), false);
  assert.equal(isRetryableError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })), true);
  assert.equal(isFatalAuthError(telegramApiError(401, "Unauthorized")), true);
  assert.equal(isFatalAuthError(telegramApiError(400, "Bad Request")), false);
  assert.equal(isParseEntityError(new Error("400: Bad Request: can't parse entities")), true);
  assert.equal(getRetryAfterMs(telegramApiError(429, "Too Many Requests", 3)), 3_000);
  assert.equal(getRetryAfterMs(new Error("nope")), undefined);
});

test("rate limits are retried after retry_after", async () => {
  const telegram = createFakeTelegram();
  telegram.failWith(telegramApiError(429, "Too Many Requests: retry after 1", 1), 1);
  const waits: number[] = [];

  const result = await sendMessageWithFallback(
    { telegram, sleep: async (ms) => void waits.push(ms), onRetry: () => undefined },
    { chatId: 1, html: "<b>hi</b>", text: "hi", useHtml: true, maxRetries: 3 },
  );

  assert.ok(result);
  assert.deepEqual(waits, [1_000]);
  assert.equal(telegram.sent.length, 1);
});

test("unparsable HTML falls back to the plain-text body", async () => {
  const telegram = createFakeTelegram();
  telegram.failWith(new Error("400: Bad Request: can't parse entities: Unsupported start tag"), 1);

  const result = await sendMessageWithFallback(
    { telegram, sleep: async () => undefined },
    { chatId: 1, html: "<broken>hi</broken>", text: "hi", useHtml: true, maxRetries: 0 },
  );

  assert.ok(result);
  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0]?.text, "hi");
  assert.equal(telegram.sent[0]?.extra?.parse_mode, undefined);
});

test("non-retryable API errors are rethrown immediately", async () => {
  const telegram = createFakeTelegram();
  telegram.failWith(telegramApiError(403, "Forbidden: bot was blocked by the user"), 5);

  await assert.rejects(
    sendMessageWithFallback(
      { telegram, sleep: async () => undefined },
      { chatId: 1, html: "hi", text: "hi", useHtml: false, maxRetries: 3 },
    ),
    /blocked/,
  );
  assert.equal(telegram.sent.length, 0);
});

test("link previews are disabled on every send", async () => {
  const telegram = createFakeTelegram();
  await sendMessageWithFallback(
    { telegram, sleep: async () => undefined },
    { chatId: 1, html: "hi", text: "hi", useHtml: true, maxRetries: 0 },
  );
  assert.deepEqual(telegram.sent[0]?.extra?.link_preview_options, { is_disabled: true });
});
