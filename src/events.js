import { EventEmitter } from "node:events";

// "order" and "enquiry" fire when new records are created. alerts.js listens to send Telegram alerts.
export const events = new EventEmitter();
