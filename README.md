# 2Brothers Services — Telegram Welcome Bot

A small, production-ready Telegram bot that posts a public welcome message when new
members join a group. It mentions the new member with `@username` when available and
falls back to a safe, clickable mention built from their Telegram name.

- **Stack:** Node.js 22 · TypeScript · [Telegraf](https://telegraf.js.org) 4 · Docker
- **State:** stateless (no database, no cache, no Redis)
- **Receives updates:** Telegram long polling by default, webhook supported
- **Config:** entirely through environment variables

> This repository contains **only the bot**. It does not touch the
> 2Brothers Services website, and it does not create a new Telegram bot — it uses
> the token of the bot you already created in [@BotFather](https://t.me/BotFather).

---

## Table of contents

1. [Features](#features)
2. [Requirements](#requirements)
3. [Quick start](#quick-start)
4. [Environment variables](#environment-variables)
5. [Customising the welcome message](#customising-the-welcome-message)
6. [Commands](#commands)
7. [BotFather setup](#botfather-setup)
8. [Telegram group setup and permissions](#telegram-group-setup-and-permissions)
9. [Local development](#local-development)
10. [Testing without spamming your group](#testing-without-spamming-your-group)
11. [Webhook vs long polling](#webhook-vs-long-polling)
12. [Deployment](#deployment)
13. [Project structure](#project-structure)
14. [Troubleshooting](#troubleshooting)
15. [Security notes](#security-notes)

---

## Features

- Welcomes **every** new member of an update, one message each.
- `@username` mention when the member has a username.
- Safe HTML mention (`tg://user?id=…`) when the member has **no** username — the numeric
  user ID is never visible in the message, only inside the link target.
- HTML-escaped names, so a member called `<b>Bob</b>` cannot break the message.
- Skips bots (configurable) and never welcomes itself.
- Optional auto-deletion of the welcome message (`WELCOME_DELETE_AFTER=1h` by default).
- Anti-duplicate: the same user is not welcomed twice inside `WELCOME_DUPLICATE_WINDOW`.
- Rate-limit aware: 429 responses are retried using Telegram's `retry_after`, transient
  network errors use exponential backoff, unparsable HTML falls back to plain text.
- Never crashes on a malformed update, and never prints your token (log redaction).
- Graceful shutdown on `SIGINT` / `SIGTERM`; the process manager (Docker/systemd) restarts it.
- Message text is fully configurable through one environment variable.

---

## Requirements

| Requirement | Notes |
| --- | --- |
| Node.js 20.11+ (22 recommended) | `node -v` |
| A Telegram bot token | From @BotFather, you already have it |
| Docker *(optional)* | Only for deployment; not needed to run locally |
| A place that stays online 24/7 | Required — see [Deployment](#deployment) |

---

## Quick start

```bash
# 1. install
npm install

# 2. create your local config
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
#    then open .env and paste your token after TELEGRAM_BOT_TOKEN=

# 3. run locally
npm run dev
```

Expected log output (no token is ever printed):

```
2026-01-01T10:00:00.000Z INFO  [main] starting {"mode":"polling","ignoreBots":true,"deleteAfter":3600000,...}
2026-01-01T10:00:00.400Z INFO  [main] bot identity confirmed {"username":"YourBot"}
```

If you see `401: Unauthorized`, the token is wrong. If you see
`bot stopped {"error":"… webhook is not available…"}`, another process is polling with the
same token — see [Troubleshooting](#troubleshooting).

---

## Environment variables

Copy `.env.example` to `.env`. **`.env` is git-ignored and must never be committed.**

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | **yes** | – | Bot token from @BotFather. Never logged. |
| `LOG_LEVEL` | no | `info` | `debug` · `info` · `warn` · `error` |
| `RUN_MODE` | no | `polling` | `polling` or `webhook` (never both) |
| `DRY_RUN` | no | `false` | Render the message and log it, send nothing |
| `WELCOME_TEMPLATE` | no | short generic message | Message body, see below |
| `WELCOME_PARSE_MODE` | no | `HTML` | `HTML` (clickable mentions) or `none` (plain text) |
| `IGNORE_BOTS` | no | `true` | `true` welcomes humans only |
| `WELCOME_DELETE_AFTER` | no | `never` | `30s`, `10m`, `1h`, `2d` or `never` |
| `WELCOME_DUPLICATE_WINDOW` | no | `10m` | Ignore a repeat join of the same user in this window |
| `MAX_RETRIES` | no | `3` | Retries for rate limits / network errors |
| `ALLOWED_CHAT_IDS` | no | *(empty)* | Empty = every group the bot is in. Otherwise comma-separated IDs, e.g. `-1001234567890,-1009876543210` |
| `SITE_URL` | no | 2Brothers site | Link used by `/about` |
| `WEBHOOK_DOMAIN` | webhook only | – | Public HTTPS base URL, e.g. `https://bot.example.com` |
| `WEBHOOK_SECRET` | recommended | random per start | Value Telegram sends in `x-telegram-bot-api-secret-token` |
| `PORT` | webhook only | `3000` | HTTP port |
| `WEBHOOK_PATH` | webhook only | `/webhook` | Update path |
| `HEALTH_PATH` | webhook only | `/health` | Health endpoint path |

`WELCOME_DELETE_AFTER=1h` requires the **Delete Messages** permission for the bot. Deletions
are held in memory: if the process restarts, pending deletions are lost (by design — the bot
stays stateless and needs no database).

Generate a webhook secret:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

---

## Customising the welcome message

The message lives in `WELCOME_TEMPLATE`. Use `\n` for line breaks and these placeholders:

| Placeholder | Result |
| --- | --- |
| `{{mention}}` | `@username`, or a clickable mention with the display name |
| `{{name}}` | `First Last` |
| `{{username}}` | `@username`, empty when the member has none |
| `{{group}}` | Group title |
| `{{groupUsername}}` | `@publicgroupname` when the group has one |

Current message:

```
👋 Welcome {{mention}} to 2Brothers Services! 🚀

We're happy to have you here!

💻 Web • Systems • Data • Cloud

🌐 https://2brothers-services.vercel.app/

Feel free to introduce yourself and enjoy the community! 🤝
```

An unknown placeholder (for example `{{nmae}}`) is logged as a warning and left as-is, so
typos are visible instead of silently producing a gap.

---

## Commands

Deliberately minimal, in **private chat** with the bot:

| Command | Response |
| --- | --- |
| `/start` | Short help text |
| `/help` | Short help text |
| `/about` | What the bot does + project link |

In a group they answer with a one-line reply, to avoid noise.

Register them in the Telegram UI once (or run `npm run bot:commands`, which does it for you):

```
@BotFather → /mybots → your bot → Edit Commands → paste:
start - Start the bot
help - Show the available commands
about - What this bot does
```

---

## BotFather setup

```
/mybots
  → select your bot
  → API Token        ← this is the value for TELEGRAM_BOT_TOKEN (keep it secret)
  → Bot Settings
      → Group Privacy
```

### Does Group Privacy need to be disabled for this bot? **No — keep it enabled.**

`Group Privacy` (privacy mode) controls which **regular** group messages a bot can read.
With privacy mode **enabled**, a bot still receives Telegram *service messages*, and
`new_chat_members` (the "X joined the group" event) is exactly such a service message.
This bot only listens to that event, so it works with privacy mode turned on.

Turn privacy mode **off** only if you later want the bot to read all group text (for
example to build commands on keywords). That is not needed here, and it is a privacy
decision for the whole group — leaving it on is the better default.

> @BotFather cannot implement welcome logic. It only configures the bot. All welcome
> behaviour lives in this project.

---

## Telegram group setup and permissions

1. Add the bot to the group (add it as a member, by username or via a group link).
2. Give it exactly these permissions — **no administrator rights required**:
   - **Send Messages** — required, to post the welcome.
   - **Delete Messages** — required only because `WELCOME_DELETE_AFTER=1h` is enabled.
     If you set `WELCOME_DELETE_AFTER=never`, remove this permission.
3. If your group restricts who may post, make sure the bot is not affected by that
   restriction (or give it the minimal permission it needs).

Do **not** grant `Make Admin`. Promoted status is only needed if you want the bot to be
hidden from the member list or to manage other administrators — neither is required here.

### Verify that join events arrive

```bash
LOG_LEVEL=debug npm run dev
```

Then add a **second test account** to the group. You should see:

```
INFO  [welcome] new member event {"chatId":-1001234567890,"chatTitle":"2Brothers Services","total":1,"eligible":1,"ignoredBots":0}
```

- No log line at all → the bot is not receiving updates (see [Troubleshooting](#troubleshooting)).
- `eligible: 0` with `ignoredBots: 1` → the member was a bot and `IGNORE_BOTS=true`.
- The `chatId` in the log is what you put in `ALLOWED_CHAT_IDS` if you want to restrict
  the bot to specific groups. This is also the easiest way to learn your group ID.

---

## Local development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch mode (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled bot |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `npm run lint:fix` | ESLint (TypeScript rules) |
| `npm test` | Full test suite (offline, no Telegram traffic) |
| `npm run simulate` | Run the real handler against a fake Telegram API |
| `npm run bot:commands` | Register `/start`, `/help`, `/about` with Telegram |

---

## Testing without spamming your group

The suite is fully offline: no network calls, no messages, no rate limits consumed.

```bash
npm test        # 47 tests: config, logger redaction, mentions, templates, dedupe, retries, HTTP server
npm run simulate  # prints the exact message for several join scenarios
```

`npm run simulate` covers the checklist without touching Telegram:

| What you want to check | How |
| --- | --- |
| Bot starts, Telegram connection works | `npm run dev`, look for `bot identity confirmed` |
| New member event is received | `LOG_LEVEL=debug npm run dev`, join with a second account |
| `@username` mention | `npm run simulate` → scenario 1 |
| Member without username is safe | `npm run simulate` → scenario 2 (escaped `tg://` mention) |
| Multiple members in one update | `npm run simulate` → scenario 3 |
| Bots ignored | `npm run simulate` → scenario 3 shows `ignoredBots: 1` |
| API errors don't crash | `npm run simulate` → last scenario, and `npm test` |
| Token never printed | `npm test` ("nothing written to stdout contains the token") |
| Health check | `npm test` (server suite) or `curl https://your-host/health` in webhook mode |

**Preview the real message against a real group without sending it:**

```bash
DRY_RUN=true LOG_LEVEL=debug npm run dev
```

The message is rendered and logged, nothing is sent. Then do a real end-to-end test in a
**private test group** with a throwaway second account — never in your production group.

---

## Webhook vs long polling

**Default: long polling.** The bot keeps one HTTPS connection open to
`api.telegram.org/getUpdates`. That is the simplest reliable architecture for a plain
always-on process (VPS, Docker, Railway worker): no public URL, no TLS certificate, no
reverse proxy, no `getWebhookInfo` debugging.

**Webhook mode** (`RUN_MODE=webhook`) is for platforms that only expose an HTTP endpoint:
Telegram POSTs every update to `https://your-domain/webhook`, the bot answers `200`, and
`GET /health` returns `{"status":"ok"}` for platform health checks. Requests without the
correct `x-telegram-bot-api-secret-token` header get `403`.

The two modes are mutually exclusive — Telegram refuses `getUpdates` while a webhook is
registered, and the bot only ever does one of the two:

- `polling` deletes any leftover webhook on start (Telegraf does this for you).
- `webhook` registers the webhook and removes it again on shutdown.

Use polling unless your host is serverless or sleeps. Sleepy free tiers are the classic
cause of "the bot sometimes misses joins": the process is not running, so no update can
arrive.

---

## Deployment

### The bot must be running continuously

A Telegram bot is not a website: nothing happens while the process is down. When it is
offline, join events are not queued for later — Telegram only keeps them for a short
period (up to 24h) and the bot drops the backlog on start, so members who joined while it
was offline are not welcomed retroactively. Running `npm run dev` on your PC is a test,
not a deployment.

### Free hosting options compared

| Option | Cost | Always on? | Verdict |
| --- | --- | --- | --- |
| **Oracle Cloud Always Free VM** | $0 | Yes | **Recommended.** Real VM, Docker, 24/7. Oracle *may* reclaim instances that stay under 20% CPU/network/memory for 7 days ([docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)), so check the console occasionally. Do not fake load to prevent it. |
| A PC / mini PC / Raspberry Pi at home | $0 (hardware you own) | Yes, while powered | Most reliable free option if the machine stays on and has a stable connection. |
| Railway (Hobby) | $5/month | Yes | Zero maintenance, run as a worker with `npm start`. The $0 tier only includes $1 of usage, which is not enough for a 0.5 GB always-on service. |
| Fly.io | — | Yes | No permanent free allowance for always-on workers. |
| Render / Koyeb free | $0 | **No** | Free web services sleep after 15 minutes idle, and free background workers are not offered. A sleeping bot misses joins. Only viable with `RUN_MODE=webhook` and a paid/always-on instance. |

### Option A — Oracle Cloud Always Free VM (recommended, free)

1. Create a free Oracle account, then in the console create a **Compute → Instances → Create**
   instance:
   - Image: Ubuntu 24.04 (or Oracle Linux)
   - Shape: `VM.Standard.A1.Flex` (1 OCPU / 1 GB) or `VM.Standard.E2.1.Micro`
   - Boot volume: 50 GB
   - **Add your SSH public key** (`ssh-keygen -t ed25519` if you do not have one)
2. Connect: `ssh -i ~/.ssh/your_key ubuntu@<public-ip>`
3. Install Docker:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   ```

4. Get the code and configure it:

   ```bash
   git clone https://github.com/RITH-1437/bot-services.git
   cd bot-services
   cp .env.example .env
   nano .env          # paste TELEGRAM_BOT_TOKEN
   ```

5. Build and run:

   ```bash
   docker compose up -d --build
   docker compose logs -f
   ```

   You should see `bot identity confirmed {"username":"YourBot"}`. `restart: unless-stopped`
   in `docker-compose.yml` means Docker starts it again after a reboot or crash.
6. Optional hardening: `sudo ufw allow OpenSSH`, `sudo ufw enable`
   (long polling needs no inbound port at all).
7. Verify it survives a restart: `sudo reboot`, wait a minute, then `docker compose ps`.

No inbound firewall rule and no port are required for long polling.

### Option B — Any Docker server (VPS, NAS, home PC)

Identical to Option A from step 4 onwards. Without Docker, run it under systemd:

```ini
# /etc/systemd/system/welcome-bot.service
[Unit]
Description=2Brothers Telegram Welcome Bot
After=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/bot-services
EnvironmentFile=/home/ubuntu/bot-services/.env
ExecStart=/usr/bin/node dist/bot.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
npm ci --omit=dev && npm run build
sudo systemctl enable --now welcome-bot
journalctl -u welcome-bot -f
```

Never put the token in `ExecStart` — it would be visible to every user on the machine
via `ps`. `EnvironmentFile` keeps it out of the process list.

### Option C — Railway (Hobby, $5/month, no server to maintain)

1. `railway init` (or *New Project → Deploy from GitHub repo*).
2. The bot is a **worker**, not a web service: remove any start command that expects a
   port and use:

   ```
   npm ci && npm run build && npm start
   ```

3. Add the variable `TELEGRAM_BOT_TOKEN` in the service's Variables tab (mark it secret).
   Set `LOG_LEVEL=info`. Leave `RUN_MODE=polling` (default) — no public domain needed.
4. Deploy and watch the logs for `bot identity confirmed`.
5. The service must not be configured to scale to zero.

### Webhook mode on a platform that requires an HTTP service

Set `RUN_MODE=webhook`, `WEBHOOK_DOMAIN=https://your-domain`, `WEBHOOK_SECRET=<random>`,
`PORT=3000`, and make sure the platform routes **all** traffic to the service (no path
rewrite, no free-tier sleep). Telegram needs a public HTTPS URL with a valid certificate;
`GET /health` is what most platforms probe.

---

## Project structure

```
.
├── src
│   ├── bot.ts                    # entry point: config, handlers, polling/webhook, shutdown
│   ├── server.ts                 # optional HTTP server: /health + /webhook (webhook mode)
│   ├── config
│   │   ├── env.ts                # env parsing + validation, safe config summary
│   │   └── logger.ts             # leveled logger with secret redaction
│   ├── handlers
│   │   ├── welcome.ts            # new_chat_members -> welcome message
│   │   └── commands.ts           # /start, /help, /about
│   ├── utils
│   │   ├── mention.ts            # safe @username / tg:// mention
│   │   ├── template.ts           # {{placeholder}} rendering
│   │   ├── html.ts               # escape / strip HTML
│   │   ├── telegram.ts           # send + retry + fallback + scheduled delete
│   │   ├── dedupe.ts             # in-memory TTL set (anti-duplicate)
│   │   └── queue.ts              # per-chat serialisation (anti 429)
│   ├── scripts
│   │   ├── setCommands.ts        # register BotFather commands via API
│   │   └── simulate.ts           # offline end-to-end simulation
│   └── testing
│       └── fakes.ts              # fake Telegram API + fake contexts
├── tests                         # node:test suites (offline)
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

Design notes: no database, no session store, no queues. The only state is a short-lived
in-memory duplicate window, which is why a restart is always safe.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN is not set` | No `.env`, or the variable is empty | `cp .env.example .env`, paste the token |
| `401: Unauthorized` | Wrong/revoked token, or a trailing space | Re-copy the token from @BotFather; regenerate it there if needed |
| `409: terminated by other getUpdates request` | A second instance is polling with the same token (often your laptop **and** the server) | Stop the other process; never run two pollers with one token |
| Bot added to the group, no welcome appears | Bot lacks *Send Messages*, or the group restricts it | Fix the bot's permissions; confirm with `LOG_LEVEL=debug` |
| No log line when someone joins | Privacy mode is off/on? → no: service messages always arrive. More likely: bot is not running, or the group is not the one you think | Check the process is alive, check `ALLOWED_CHAT_IDS` |
| Welcome sent, but the clickable name is missing | Member has no username and `WELCOME_PARSE_MODE=none` | Set `WELCOME_PARSE_MODE=HTML` |
| `unknown placeholder in WELCOME_TEMPLATE` | Typo in the template | Fix the spelling; the placeholder is shown as-is in the message |
| Welcome not deleted after `1h` | Bot lacks *Delete Messages*, or the process restarted | Grant the permission; pending deletions are lost on restart by design |
| `429 Too Many Requests` in logs | Normal rate limiting (e.g. after a big migration) | Automatic: the bot waits `retry_after` and retries. Lower `MAX_RETRIES` or slow down bulk joins if it persists |
| `Error: 400: Bad Request: can't parse entities` | Broken HTML in the template | The bot automatically retries as plain text; fix `WELCOME_TEMPLATE` |
| Docker container exits immediately | Missing token | `docker compose logs` shows the exact reason |
| Bot works locally, not on the server | `.env` not copied to the server, or `env_file` missing | `.env` is git-ignored on purpose: create it on the server |

---

## Security notes

- The token is **only** read from `TELEGRAM_BOT_TOKEN`. It is never hardcoded, never
  committed, and never printed:
  - the logger redacts the token value, anything shaped like `bot<id>:<secret>`, and
    `token=` / `secret_token=` patterns before anything reaches stdout;
  - the startup log prints a safe summary (`tokenConfigured: true`) instead of the config;
  - errors are logged as `name: message` without environment dumps.
- `.env` is in `.gitignore` and in `.dockerignore`, so it can reach neither GitHub nor an
  image layer. `.env.example` contains no real values.
- Do not set the `DEBUG` environment variable in production: Telegraf's internal debug
  output is not redacted. The bot warns about this at startup.
- Webhook mode validates `x-telegram-bot-api-secret-token` on every request and rejects
  bodies over 1 MB, so random callers cannot push fake updates.
- The bot needs no administrator rights, so a compromise cannot change group settings.
- If the token ever leaks: revoke it in @BotFather (`/revoke`), paste the new one into the
  server's `.env` and restart. Anyone holding the token can read and write for the bot.
- The bot only reads join events and the `/start`, `/help`, `/about` commands. It does not
  read or store regular group messages, and it stores nothing at all.
