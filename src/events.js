import { EventEmitter } from "node:events";

// "order", "enquiry", "fileOrder" and "creditPayment" (a UPI payment to check) fire when new records
// are created. alerts.js listens to send Telegram alerts.
export const events = new EventEmitter();
