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
3. **Vehicles**: check the Stage 1, 2 and 3 figures against your own results. Clear Stage 2 and 3 for anything you don't offer.
4. **ECUs**: set which ECUs you support.
5. **Settings → Telegram alerts**: press **Connect a Telegram chat**, open the link on your phone and press Start. You'll get a message for every new order and enquiry.
6. **Telegram bot picture**: in @BotFather, open `/mybots` → your bot → **Edit Bot**, then send `brand/telegram-profile-photo.png` for **Edit Botpic** and `brand/telegram-description-picture.png` for **Edit Description Picture**.

New shop orders and Stage 1, 2 and 3 enquiries, from both the website and the Telegram bot, appear under **Orders** and **Enquiries**.

## Host it 24/7 on your own VPS

You need a VPS (any provider) with Ubuntu 24.04, and a domain name.

1. At your domain provider, add an **A record** for your domain (for example `shop.example.com`) pointing to the VPS's IP address.
2. Upload `unity-performance-vps.zip` to the server. On Mac, or in Windows PowerShell, run this on your computer, using the username your VPS provider gave you (often `root` or `ubuntu`):

   ```bash
   scp unity-performance-vps.zip root@YOUR_SERVER_IP:~/
   ```

   WinSCP or FileZilla (SFTP) also work. Upload the zip as it is; don't unpack it on your computer first.
3. Connect to the server (`ssh root@YOUR_SERVER_IP`) and run:

   ```bash
   sudo apt-get update && sudo apt-get install -y unzip
   sudo unzip -q ~/unity-performance-vps.zip -d /opt
   sudo bash /opt/unity-performance/deploy/vps/install.sh shop.example.com
   ```

   Answer its questions: WhatsApp number, Telegram bot token, OpenAI key and admin password. Press Enter to have a password created, and save the one it prints.
4. Open `https://shop.example.com/admin` and sign in.
5. Stop any other copy of the bot, such as the one on your computer. Only one can run at a time.

To update later, upload the new zip the same way and run `sudo bash /opt/unity-performance/deploy/vps/update.sh ~/unity-performance-vps.zip`. It checks the new version before switching, and if anything goes wrong it keeps the current version running. Your orders, products and settings are never touched by an update.

Your data is backed up every day to `/var/backups/unity-performance`. Download a copy to your computer now and then, or turn on your VPS provider's snapshots.

## Or host it on Render

The project includes `render.yaml` for [Render](https://dashboard.render.com/). It creates one web service with a disk, so your orders and products are kept.

1. Upload the project to a private GitHub repository (never upload `.env`).
2. In Render, create a **Blueprint** from the repository.
3. Enter `ADMIN_PASSWORD`, `WHATSAPP_NUMBER`, `TELEGRAM_BOT_TOKEN` and `OPENAI_API_KEY` in the secret fields.
4. Deploy, then open the web address Render gives you. Stop the copy on your Mac so only one bot is running.

Review the price Render shows before creating it; web services with disks need a paid plan.
