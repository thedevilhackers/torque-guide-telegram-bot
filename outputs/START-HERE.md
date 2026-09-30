# Start your Unity Performance Telegram bot

Telegram is the easy route: you do **not** need a Meta app, WhatsApp Business API, callback URL, public tunnel or VM. Customers send their enquiry to your normal WhatsApp number themselves, with the message already filled in.

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, choose a name and a username ending in `bot`.
2. BotFather gives you a private token. Do not share it in chat.
3. In the project folder, copy `.env.example` to `.env`.
4. Open `.env` and add:

   ```dotenv
   TELEGRAM_BOT_TOKEN=paste-botfather-token-here
   OPENAI_API_KEY=paste-openai-platform-key-here
   WHATSAPP_NUMBER=your-whatsapp-number-with-country-code-digits-only
   ```

5. In Terminal, open the project folder and run:

   ```bash
   npm test
   npm start
   ```

6. Search for your bot's username in Telegram and send `/start`.

Customers search their vehicle and receive a Stage 1 power graph. They then share their location and check their ECU against your supported list. Finally they tap **Send full details on WhatsApp** to message you everything.

Before going live, update the Stage 1 figures in `src/vehicles.js` and the ECU list in `src/catalog.js` to match your own dyno results and tools.

## Host it 24/7

The project includes a Render hosting file named `render.yaml`.

1. Create a private GitHub repository and upload the project files. Do **not** upload `.env`.
2. Open [Render](https://dashboard.render.com/), create a **Blueprint**, then choose your GitHub repository.
3. Render asks for `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY` and `WHATSAPP_NUMBER`. Paste them only into Render's secret-value fields.
4. Start the deployment. When the log says the bot is running, stop the copy running on your Mac.

The hosted bot has no callback URL because it uses Telegram long polling. Review the host's displayed cost before creating it; background workers are not on Render's free plan.
