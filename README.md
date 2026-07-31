# Torque Guide Telegram Bot

This is a Node.js Telegram bot for vehicle-tuning enquiries. It uses inline menus to collect the vehicle brand, model, fuel type, model year, ECU family and requested tuning stage. It then uses OpenAI to return a cautious planning estimate: power figures, required parts/work and pre-tuning checks.

It intentionally does **not** generate tune files, claim unverified specifications, or suggest disabling emissions, safety or diagnostic systems.

## What you need

- Node.js 20 or newer
- A Telegram account
- An OpenAI Platform API key (a ChatGPT subscription is not an API key)

No VM, callback URL, web domain or public tunnel is required for local testing. The bot uses Telegram long polling.

## 1. Create your Telegram bot

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Choose a display name, then a username ending in `bot`, for example `TorqueGuideDemoBot`.
4. BotFather gives you a bot token. Treat it like a password: do not send it in chat or commit it to Git.

## 2. Create your local settings file

In this folder, copy `.env.example` to `.env` and add your two private values:

```dotenv
TELEGRAM_BOT_TOKEN=paste-the-token-from-botfather
OPENAI_API_KEY=paste-your-openai-platform-key
OPENAI_MODEL=gpt-5.6-terra
```

The default model is configurable. Keep `gpt-5.6-terra` for a balance of response quality and cost, or select a model enabled for your OpenAI project.

## 3. Start and test the bot

```bash
npm test
npm start
```

When the terminal says the bot is running, open the link BotFather gave you or search its username in Telegram. Press **Start** or send `/start`.

The bot presents inline buttons for every selection. Each button tap is sent to the bot immediately; no callback URL is needed. Telegram users must message the bot first before the bot can send them a private message.

## 4. Host it on Render (24/7)

This repository includes `render.yaml`, which packages the bot as a single Render **background worker**. It uses long polling, so it does not expose a web address or need a Telegram callback URL.

1. Create a private GitHub repository and upload this project. Do not upload `.env`.
2. In [Render](https://dashboard.render.com/), create a new **Blueprint** and select that GitHub repository.
3. Render reads `render.yaml` and asks for `TELEGRAM_BOT_TOKEN` and `OPENAI_API_KEY`. Enter them only in Render's secret fields.
4. Create the service and wait for the deploy log to say `Torque Guide Telegram bot is running`.
5. Stop any local `npm start` instance before testing the hosted bot. Telegram allows only one long-polling process to consume a bot's updates at a time.

Render background workers are not available on its free plan. Review the displayed plan and cost before creating the service. The worker is deliberately configured with one instance, because the bot's file-based session store is intended for a single instance.

## 5. Keep it online later

For initial testing, leave your Mac on with `npm start` running. For a 24/7 production bot, the Render deployment above is sufficient. Long polling still works—there is no need to configure a Telegram webhook unless you choose to use webhooks later.

Before launching publicly:

- Store API keys as host environment variables, not in source code.
- Move `data/sessions.json` to a managed database before running multiple bot instances.
- Add a privacy notice and data-retention policy.
- Validate each vehicle-specific recommendation with a qualified tuner and a vetted vehicle/engine/ECU database.

## Customise the menus

Edit `src/catalog.js` to add brands, models, ECU families or tuning stages. The bot's menu IDs are short Telegram callback values and are intentionally kept separate from the display titles.

## Official references

- [Telegram: creating a bot with BotFather](https://core.telegram.org/bots/tutorial)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI API keys](https://platform.openai.com/api-keys)
