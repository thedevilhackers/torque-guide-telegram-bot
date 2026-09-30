import { createServer } from "node:http";
import { config, optionalSettingWarnings } from "./config.js";
import { settings } from "./db.js";
import { startBot } from "./telegram-bot.js";
import { createApp } from "./web/app.js";

// Runs the website, the admin panel and the Telegram bot in one process, so they share one database.

let botUsername = "";
const server = createServer(createApp({ botUsername: () => botUsername }));

server.listen(config.port, () => {
  console.log(`${settings().businessName} website is running on http://localhost:${config.port} (admin: /admin)`);
  for (const warning of optionalSettingWarnings()) console.warn(`Note: ${warning}`);
});

if (config.telegramBotToken) {
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
