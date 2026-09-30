# Unity Performance Telegram Bot

A Node.js Telegram bot for Unity Performance's Stage 1 tuning enquiries. Customers find their vehicle and get a branded Stage 1 power graph. They then add their location and check their ECU. At the end they send you the full details on WhatsApp with one tap.

## What customers see

1. **Vehicle search menu**: customers type their vehicle (for example `Golf GTI 2018` or `Hilux 2.8`) or browse by brand. Vehicles not in your list are identified by AI.
2. **Stage 1 performance graph**: a dyno-style PNG showing stock against Stage 1 power and torque curves, with the gains (+hp, +Nm, %). A short Stage 1 report follows, covering what changes, what to prepare and what you check on the day.
3. **Location**: customers tap **Share my location** (GPS) or type their city or area.
4. **ECU check**: customers pick the ECU on their label. ⭐ marks the ECUs commonly fitted to their vehicle. The bot checks it against your supported-ECU list (✅ supported, ⚠️ on request, ❌ not supported, ❓ we'll identify it).
5. **WhatsApp**: a summary with a **Send full details on WhatsApp** button. It opens WhatsApp with the enquiry already written to your number (name, vehicle, stock and Stage 1 figures, ECU and location), and the customer just presses send.

The main menu also has **🤖 Ask AI** (a tuning Q&A assistant), **🧾 ECUs we support**, **📍 Our workshop** (if configured) and **💬 Chat with us on WhatsApp**.

### Where AI is used

With an `OPENAI_API_KEY`, the bot uses the OpenAI Responses API to:

- identify vehicles that aren't in your database and estimate their figures. These estimates are kept within your Stage 1 gain limits and marked **AI estimate** on the graph and in the WhatsApp message;
- write a Stage 1 report for the selected vehicle, without changing your figures;
- answer customer questions in **Ask AI** mode.

Without a key the bot still works: search uses your database only, and the Stage 1 report uses built-in templates. The AI is instructed never to advise removing or disabling emissions (DPF, EGR, catalyst, AdBlue) or safety systems.

## What you need

- Node.js 20 or newer (no npm packages are needed; the graph is drawn in pure JavaScript)
- A Telegram account
- A WhatsApp number to receive enquiries
- Optional: an OpenAI Platform API key (a ChatGPT subscription is not an API key)

## 1. Create your Telegram bot

1. In Telegram, open [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Choose a display name, then a username ending in `bot`, for example `UnityPerformanceBot`.
4. BotFather gives you a bot token. Treat it like a password: do not send it in chat or commit it to Git.

## 2. Create your local settings file

Copy `.env.example` to `.env` and fill it in:

```dotenv
TELEGRAM_BOT_TOKEN=paste-the-token-from-botfather
OPENAI_API_KEY=paste-your-openai-platform-key
OPENAI_MODEL=gpt-5.6-terra
BUSINESS_NAME=Unity Performance
WHATSAPP_NUMBER=94771234567
```

| Setting | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | Token from BotFather. |
| `OPENAI_API_KEY` | No | Turns on AI search, AI reports and Ask AI. |
| `OPENAI_MODEL` | No | OpenAI model; defaults to `gpt-5.6-terra`. |
| `BUSINESS_NAME` | No | Shown in messages and on the graph; defaults to `Unity Performance`. |
| `WHATSAPP_NUMBER` | Recommended | Number that receives enquiries, in international format with digits only (e.g. `94771234567`). Without it, the WhatsApp button asks the customer to pick a contact. |
| `WORKSHOP_ADDRESS` | No | Shows **📍 Our workshop** with a Google Maps link. |
| `WORKSHOP_LATITUDE`, `WORKSHOP_LONGITUDE` | No | Sends your workshop as a Telegram map pin instead. |

## 3. Start and test the bot

```bash
npm test
npm start
```

When the terminal says the bot is running, open your bot in Telegram and press **Start** or send `/start`. The bot registers its commands (`/start`, `/search`, `/ask`, `/ecus`) so they appear in Telegram's menu.

## 4. Host it on Render (24/7)

This repository includes `render.yaml`, which packages the bot as a single Render **background worker**. It uses long polling, so it does not need a web address or a Telegram callback URL.

1. Create a private GitHub repository and upload this project. Do not upload `.env`.
2. In [Render](https://dashboard.render.com/), create a new **Blueprint** and select that GitHub repository.
3. Render reads `render.yaml` and asks for `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY` and `WHATSAPP_NUMBER`. Enter them only in Render's secret fields. To show your workshop, add `WORKSHOP_ADDRESS` (and optionally the coordinates) under the service's **Environment** tab.
4. Create the service and wait for the deploy log to say `Unity Performance Telegram bot is running`.
5. Stop any local `npm start` instance before testing the hosted bot. Telegram allows only one long-polling process to consume a bot's updates at a time.

Render background workers are not available on its free plan. Review the displayed plan and cost before creating the service. The worker is deliberately configured with one instance, because the bot's file-based session store is intended for a single instance.

## Customise it

- **Vehicles and Stage 1 figures**: edit `VEHICLES` in `src/vehicles.js`. Each entry has factory `stock` and your `stage1` figures as `[hp, Nm]`, the ECUs commonly fitted, and search keywords. Optional `redline` and `torqueFrom` values reshape the graph for unusual engines. **The included Stage 1 figures are typical starting values. Replace them with your own dyno-verified results before quoting customers.**
- **AI estimate limits**: `STAGE1_GAINS` in `src/vehicles.js` sets the minimum and maximum Stage 1 gain allowed for AI-identified vehicles, by fuel and aspiration.
- **Supported ECUs**: edit `ECUS` in `src/catalog.js`. Set each ECU's `status` (`supported`, `on_request` or `not_supported`) and its read/write `method` to match your tools.
- **Brands**: `BRANDS` in `src/catalog.js`, including search aliases such as `vw` or `merc`.
- **Graph colours and layout**: `THEME` and the layout constants in `src/dyno-chart.js`.

The graph's curves are estimates generated from each vehicle's peak figures, shaped by engine type. The peaks always match your figures exactly, and the graph is labelled as an estimate to be confirmed on the dyno.

## Before launching publicly

- Store API keys as host environment variables, not in source code.
- Move `data/sessions.json` to a managed database before running multiple bot instances.
- Add a privacy notice and data-retention policy, since the bot stores customers' names and locations.
- Verify your vehicle database and ECU list, and have a qualified tuner confirm each vehicle before tuning.

## Official references

- [Telegram: creating a bot with BotFather](https://core.telegram.org/bots/tutorial)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI API keys](https://platform.openai.com/api-keys)
