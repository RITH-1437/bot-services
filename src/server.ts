import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Telegraf } from "telegraf";
import type { HttpConfig } from "./config/env";
import { createLogger, formatError } from "./config/logger";

const log = createLogger("http");

/** Telegram updates are small; anything larger is not a real update. */
const MAX_BODY_BYTES = 1_048_576;

export interface HttpServerHandle {
  server: Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

/**
 * Minimal HTTP surface used only in webhook mode:
 * GET /health for platform health checks and POST /webhook for Telegram.
 * It never exposes configuration values or secrets.
 */
export function createHttpServer(bot: Telegraf, config: HttpConfig): HttpServerHandle {
  const startedAt = Date.now();
  const expectedSecret = config.webhookSecret;

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      log.error("request failed", { error: formatError(error) });
      if (!res.headersSent) sendJson(res, 500, { status: "error" });
      else res.end();
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === config.healthPath) {
      sendJson(res, 200, {
        status: "ok",
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
      return;
    }

    if (req.method === "POST" && path === config.webhookPath) {
      if (expectedSecret !== null) {
        const provided = req.headers["x-telegram-bot-api-secret-token"];
        if (provided !== expectedSecret) {
          log.warn("rejected webhook request with invalid secret header");
          sendJson(res, 403, { status: "forbidden" });
          return;
        }
      }

      let raw: string;
      try {
        raw = await readBody(req);
      } catch (error) {
        log.warn("could not read webhook body", { error: formatError(error) });
        sendJson(res, 400, { status: "bad request" });
        return;
      }

      let update: unknown;
      try {
        update = JSON.parse(raw);
      } catch {
        log.warn("webhook body was not valid JSON");
        sendJson(res, 400, { status: "bad request" });
        return;
      }

      if (update === null || typeof update !== "object") {
        sendJson(res, 400, { status: "bad request" });
        return;
      }

      try {
        await bot.handleUpdate(update as Parameters<Telegraf["handleUpdate"]>[0]);
      } catch (error) {
        // Answer 200 anyway: the update was consumed, and replying with an error
        // would make Telegram redeliver it and duplicate the welcome message.
        log.error("update handling failed", { error: formatError(error) });
      }

      sendJson(res, 200, { status: "ok" });
      return;
    }

    sendJson(res, 404, { status: "not found" });
  }

  return {
    server,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(config.port, "0.0.0.0", () => {
          log.info("http server listening", { port: config.port, health: config.healthPath });
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
