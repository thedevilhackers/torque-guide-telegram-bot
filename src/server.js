import { createServer } from "node:http";
import { startAlerts } from "./alerts.js";
import { config, optionalSettingWarnings } from "./config.js";
import { settings } from "./db.js";
import { startBot } from "./telegram-bot.js";
import { sendText } from "./telegram.js";
import { createApp } from "./web/app.js";

// Runs the website, the admin panel and the Telegram bot in one process, so they share one database.

let botUsername = "";
const sendAlert = config.telegramBotToken ? sendText : null;
const server = createServer(createApp({ botUsername: () => botUsername, sendAlert }));

server.listen(config.port, config.host, () => {
  console.log(`${settings().businessName} website is running on http://${config.host ?? "localhost"}:${config.port} (admin: /admin)`);
  for (const warning of optionalSettingWarnings()) console.warn(`Note: ${warning}`);
});

if (config.telegramBotToken) {
  startAlerts({ send: sendText });
  startBot()
    .then((username) => {
      botUsername = username;
    })
    .catch((error) => console.error("Telegram bot could not start:", error.message));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
