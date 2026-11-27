# Feedback Worker (issue.vuurtoren.app)

The app's feedback button sends reports here. Each one is stored for 90 days and sent to your
Telegram with **Make issue** and **Done**. Make issue opens a GitHub issue with the text and the
device facts, and never the screenshot. If you reply to the message in Telegram, the tester sees
your reply in the app, if they agreed to replies.

It runs on Cloudflare's free plan: a Worker, one D1 database, one R2 bucket for the screenshots and
voice notes (optional: they're in your Telegram chat too) and Workers AI for the voice notes.

## Set it up once

You need `npx wrangler login` with the Cloudflare account that has vuurtoren.app.

1. **The bot.** In Telegram, talk to @BotFather: `/newbot`, any name, and keep the token. Send
   your new bot one message, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and note `"chat":{"id":…}`. That's your chat id.
2. **The GitHub token.** github.com → Settings → Developer settings → Fine-grained tokens → new
   token, only the Vuurtoren repository, permission **Issues: Read and write**. Also make the
   labels `from a tester`, `desktop`, `phone`, `android`, `windows`, `macos` and `linux` in the
   repository.
3. **Storage.** From this folder:
   ```sh
   npx wrangler d1 create vuurtoren-feedback      # put its database_id into wrangler.toml
   npx wrangler r2 bucket create vuurtoren-feedback   # optional, needs R2 turned on
   npx wrangler d1 execute vuurtoren-feedback --remote --file=schema.sql
   ```
4. **Secrets.** Each one asks for its value:
   ```sh
   npx wrangler secret put TG_TOKEN       # from step 1
   npx wrangler secret put TG_CHAT_ID     # from step 1
   npx wrangler secret put GITHUB_TOKEN   # from step 2
   npx wrangler secret put APP_KEY        # any long random text: openssl rand -hex 16
   npx wrangler secret put TG_SECRET      # another one: openssl rand -hex 16
   npx wrangler secret put SALT           # and another
   ```
5. **Deploy**, and point the bot at the Worker:
   ```sh
   npx wrangler deploy
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://issue.vuurtoren.app/tg/hook&secret_token=<TG_SECRET>"
   ```
6. **The app.** Builds take the key from `VITE_FEEDBACK_KEY` (the same APP_KEY). Put it in
   `apps/web/.env.local`:
   ```sh
   VITE_FEEDBACK_KEY=<APP_KEY>
   ```
   Without it the app doesn't show the feedback button.

## One topic per tester

Each tester gets their own topic in a Telegram group, and what you write in that topic goes back
to their app. To switch it on once:

1. Make a Telegram group, open its settings and turn on Topics.
2. Add the bot and make it an admin with "Manage topics" (an admin bot sees every message).
3. Send any message in the group, open
   `https://api.telegram.org/bot<token>/getUpdates` and copy the chat id (it starts with `-100`).
4. `npx wrangler secret put TG_CHAT_ID` with that id.

Without a group the bot keeps posting to your private chat, and you answer by replying to a
report.

## If someone abuses it

Each address can send 20 reports an hour (`LIMITS.perHour` in `src/logic.ts`). If a key gets misused, set a new `APP_KEY`, and older
builds get "Update Vuurtoren" when they send feedback.

## Tests

`../../apps/web/node_modules/.bin/vitest run --root .` runs the tests of `src/logic.ts`.