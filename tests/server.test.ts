import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Telegraf } from "telegraf";
import type { HttpConfig } from "../src/config/env";
import { createHttpServer } from "../src/server";

const SECRET = "test-webhook-secret";

function makeConfig(overrides: Partial<HttpConfig> = {}): HttpConfig {
  return {
    port: 0,
    webhookDomain: "https://bot.example.com",
    webhookPath: "/webhook",
    webhookSecret: SECRET,
    healthPath: "/health",
    ...overrides,
  };
}

function makeBot() {
  const updates: unknown[] = [];
  const bot = {
    handleUpdate: async (update: unknown) => {
      updates.push(update);
    },
  };
  return { bot: bot as unknown as Telegraf, updates };
}

async function withServer(
  config: HttpConfig,
  run: (baseUrl: string) => Promise<void>,
): Promise<{ updates: unknown[] }> {
  const { bot, updates } = makeBot();
  const handle = createHttpServer(bot, config);
  await handle.start();
  const { port } = handle.server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await handle.stop();
  }
  return { updates };
}

test("GET /health answers ok without exposing secrets", async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string; uptimeSeconds: number };
    assert.equal(body.status, "ok");
    assert.equal(typeof body.uptimeSeconds, "number");
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(SECRET), "health response leaked a secret");
  });
});

test("POST /webhook requires the secret header and forwards valid updates", async () => {
  const result = await withServer(makeConfig(), async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(unauthorized.status, 403);

    const wrongSecret = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "nope" },
      body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(wrongSecret.status, 403);

    const accepted = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
      body: JSON.stringify({ update_id: 2, message: { text: "hi" } }),
    });
    assert.equal(accepted.status, 200);
  });

  assert.equal(result.updates.length, 1);
});

test("malformed webhook bodies are rejected without crashing", async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const notJson = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
      body: "not json at all",
    });
    assert.equal(notJson.status, 400);

    const notAnObject = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
      body: "42",
    });
    assert.equal(notAnObject.status, 400);
  });
});

test("unknown routes return 404 json", async () => {
  await withServer(makeConfig(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/nope`);
    assert.equal(response.status, 404);
    assert.equal(((await response.json()) as { status: string }).status, "not found");
  });
});
