# Start your Torque Guide Telegram bot

Telegram is the easy test route: you do **not** need a Meta app, WhatsApp phone number, callback URL, public tunnel or VM.

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, choose a name and a username ending in `bot`.
2. BotFather gives you a private token. Do not share it in chat.
3. In the project folder, copy `.env.example` to `.env`.
4. Open `.env` and add:

   ```dotenv
   TELEGRAM_BOT_TOKEN=paste-botfather-token-here
   OPENAI_API_KEY=paste-openai-platform-key-here
   ```

5. In Terminal, open the project folder and run:

   ```bash
   npm test
   npm start
   ```

6. Search for your bot's username in Telegram and send `/start`.

The bot shows menus for vehicle brand, model, fuel, year, ECU family and tuning stage, then returns a cautious AI-generated estimate and parts list.

## Host it 24/7

The project now includes a Render hosting file named `render.yaml`.

1. Create a private GitHub repository and upload the project files. Do **not** upload `.env`.
2. Open [Render](https://dashboard.render.com/), create a **Blueprint**, then choose your GitHub repository.
3. Render asks for `TELEGRAM_BOT_TOKEN` and `OPENAI_API_KEY`. Paste them only into Render's secret-value fields.
4. Start the deployment. When the log says the bot is running, stop the copy running on your Mac.

The hosted bot has no callback URL because it uses Telegram long polling. Review the host's displayed cost before creating it; background workers are not on Render's free plan.
