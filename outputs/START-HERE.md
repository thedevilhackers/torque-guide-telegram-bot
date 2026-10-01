# Start your Unity Performance website, shop and bot

Everything runs from this one project: the website, the shop, the admin panel and the Telegram bot.

1. In the project folder, copy `.env.example` to `.env` and fill in:

   ```dotenv
   ADMIN_PASSWORD=choose-a-strong-password-10+-characters
   WHATSAPP_NUMBER=your-whatsapp-number-with-country-code-digits-only
   TELEGRAM_BOT_TOKEN=paste-botfather-token-here     # optional
   OPENAI_API_KEY=paste-openai-platform-key-here      # optional
   ```

2. In Terminal, run:

   ```bash
   npm test
   npm start
   ```

3. Open http://localhost:3000 for the website and http://localhost:3000/admin for the admin panel (username `admin`).

## First things to do in the admin panel

1. **Settings**: your business name, WhatsApp number, address, opening hours, currency and a hero photo.
2. **Products**: replace the sample products with yours, including prices, stock and photos.
3. **Vehicles**: check the Stage 1, 2 and 3 figures against your own dyno results. Clear Stage 2 and 3 for anything you don't offer.
4. **ECUs**: set which ECUs you support.
5. **Settings → Telegram alerts**: press **Connect a Telegram chat**, open the link on your phone and press Start. You'll get a message for every new order and enquiry.
6. **Telegram bot picture**: in @BotFather, open `/mybots` → your bot → **Edit Bot**, then send `brand/telegram-profile-photo.png` for **Edit Botpic** and `brand/telegram-description-picture.png` for **Edit Description Picture**.

New shop orders and Stage 1, 2 and 3 enquiries, from both the website and the Telegram bot, appear under **Orders** and **Enquiries**.

## Host it 24/7

The project includes `render.yaml` for [Render](https://dashboard.render.com/). It creates one web service with a disk, so your orders and products are kept.

1. Upload the project to a private GitHub repository (never upload `.env`).
2. In Render, create a **Blueprint** from the repository.
3. Enter `ADMIN_PASSWORD`, `WHATSAPP_NUMBER`, `TELEGRAM_BOT_TOKEN` and `OPENAI_API_KEY` in the secret fields.
4. Deploy, then open the web address Render gives you. Stop the copy on your Mac so only one bot is running.

Review the price Render shows before creating it; web services with disks need a paid plan.
