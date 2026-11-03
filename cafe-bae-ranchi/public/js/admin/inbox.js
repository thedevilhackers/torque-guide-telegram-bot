import { call, can, emptyState, h, icon, rerender, segmented, send, timeAgo, waLink } from "./core.js";

const view = { mode: "chats", phone: null, els: null, status: null, filter: "" };
const TICKS = { queued: "Sending…", sent: "✓ Sent", delivered: "✓✓ Delivered", read: "✓✓ Read", failed: "Failed" };
const EVENT_LABELS = {
  order_staff_alert: "New order alert",
  booking_staff_alert: "New booking alert",
  enquiry_staff_alert: "Party enquiry alert",
  order_received: "Order received",
  order_preparing: "Order preparing",
  order_ready: "Order ready",
  booking_confirmed: "Booking confirmed",
  booking_cancelled: "Booking cancelled",
  auto_reply: "Auto-reply",
  auto_reply_fallback: "Auto-reply",
  reply: "Staff reply",
  test: "Test message"
};
const QUICK_REPLIES = [
  "Thanks for your message! Your order is ready at the counter.",
  `Hi! Here's our menu with online ordering: ${location.origin}/#menu`,
  "Thank you for visiting Cafe BAE. See you again soon!"
];

const pretty = (phone) => `+${phone}`;

function setupCard(status) {
  return h(
    "section",
    { class: "panel wa-setup" },
    h("h2", { text: status.configured ? "WhatsApp is connected but switched off" : "You're in click-to-chat mode" }),
    h(
      "p",
      { class: "muted" },
      status.configured
        ? "Turn WhatsApp on in Settings → WhatsApp to start sending automatic alerts, customer updates and auto-replies."
        : "Every order, booking and enquiry already has a WhatsApp button that opens a ready-written message on your phone. To send messages automatically, get auto-replies and chat with customers from this screen, connect the WhatsApp Business Cloud API (see README → WhatsApp setup)."
    ),
    can("settings") ? h("button", { type: "button", class: "btn btn-sm btn-primary", onclick: () => document.querySelector('#tabs [data-tab="settings"]')?.click() }, "Open WhatsApp settings") : null
  );
}

function bubble(message) {
  const outgoing = message.direction === "out";
  return h(
    "div",
    { class: `bubble ${outgoing ? "out" : "in"}${message.status === "failed" ? " failed" : ""}` },
    outgoing && message.kind === "template" ? h("span", { class: "bubble-tag", text: EVENT_LABELS[message.event] ?? "Template" }) : null,
    h("p", { text: message.body }),
    h(
      "span",
      { class: "bubble-meta" },
      outgoing && message.by ? `${message.by} · ` : "",
      new Date(message.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
      outgoing ? ` · ${TICKS[message.status] ?? message.status}` : ""
    ),
    message.error ? h("span", { class: "bubble-error", text: message.error }) : null
  );
}

function drawList(conversations) {
  const { list } = view.els;
  const q = view.filter.toLowerCase();
  const shown = conversations.filter((c) => !q || c.phone.includes(q.replace(/\D/g, "") || "~") || c.name.toLowerCase().includes(q));
  if (!shown.length) {
    list.replaceChildren(h("p", { class: "col-empty", text: conversations.length ? "No chats match." : "No chats yet. Messages customers send to your WhatsApp Business number appear here." }));
    return;
  }
  list.replaceChildren(
    ...shown.map((c) =>
      h(
        "button",
        {
          type: "button",
          class: `convo${c.phone === view.phone ? " active" : ""}`,
          onclick: () => {
            view.phone = c.phone;
            drawList(conversations);
            drawThread();
          }
        },
        h("span", { class: "avatar", "aria-hidden": "true", text: (c.name || "#").charAt(0).toUpperCase() }),
        h(
          "span",
          { class: "convo-text" },
          h("strong", { text: c.name || pretty(c.phone) }),
          h("small", { text: `${c.last.direction === "out" ? "You: " : ""}${c.last.body}` })
        ),
        h("span", { class: "convo-side" }, h("small", { text: timeAgo(c.last.at) }), c.unread ? h("span", { class: "count", text: String(c.unread) }) : null)
      )
    )
  );
}

async function drawThread() {
  const { thread } = view.els;
  if (!view.phone) {
    thread.replaceChildren(emptyState("Pick a chat", "Select a conversation on the left to read and reply."));
    return;
  }
  const data = await call(`/api/admin/whatsapp/conversations/${view.phone}`);
  const messages = h("div", { class: "thread-messages" }, data.messages.map(bubble));
  const configured = view.status?.configured;
  const replyBox = h("textarea", { rows: "2", placeholder: data.canReply ? "Type a reply…" : "Replies are closed for this chat", maxlength: "4000", "aria-label": "Reply", disabled: !configured || !data.canReply });
  const sendButton = h("button", { type: "submit", class: "btn btn-sm btn-primary", disabled: !configured || !data.canReply }, icon("send"), "Send");
  const form = h(
    "form",
    {
      class: "composer",
      onsubmit: async (event) => {
        event.preventDefault();
        if (!replyBox.value.trim()) return;
        sendButton.disabled = true;
        try {
          await send("POST", `/api/admin/whatsapp/conversations/${view.phone}/messages`, { text: replyBox.value.trim() }, "Reply sent");
          replyBox.value = "";
          await drawThread();
        } finally {
          sendButton.disabled = false;
        }
      }
    },
    data.canReply && configured ? h("div", { class: "quick-replies" }, QUICK_REPLIES.map((text) => h("button", { type: "button", class: "chip chip-btn", onclick: () => (replyBox.value = text), text: text.length > 34 ? `${text.slice(0, 32)}…` : text }))) : null,
    h("div", { class: "composer-row" }, replyBox, sendButton),
    !data.canReply
      ? h("p", { class: "composer-note", text: "WhatsApp only allows free replies within 24 hours of the customer's last message. Use “Open in WhatsApp” to message them from your phone." })
      : null
  );
  thread.replaceChildren(
    h(
      "header",
      { class: "thread-head" },
      h("div", {}, h("strong", { text: data.name || pretty(data.phone) }), h("small", { text: pretty(data.phone) })),
      h("span", { class: `chip ${data.canReply ? "chip-ok" : ""}`, text: data.canReply ? "Reply window open" : "Reply window closed" }),
      waLink(data.phone, "", "Open in WhatsApp")
    ),
    messages,
    form
  );
  messages.scrollTop = messages.scrollHeight;
}

async function renderLog() {
  const { messages } = await call("/api/admin/whatsapp/log");
  if (!messages.length) return emptyState("No messages sent yet", "Automatic alerts, customer updates and replies will be listed here with their delivery status.");
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "menu-table log-table" },
      h("thead", {}, h("tr", {}, ["When", "To", "Type", "Message", "Status"].map((label) => h("th", { text: label })))),
      h(
        "tbody",
        {},
        messages.map((m) =>
          h(
            "tr",
            {},
            h("td", { text: new Date(m.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) }),
            h("td", { text: pretty(m.phone) }),
            h("td", { text: EVENT_LABELS[m.event] ?? m.event }),
            h("td", { class: "log-body", text: m.body }),
            h("td", {}, h("span", { class: `wa-badge wa-${m.status}`, title: m.error || "" }, TICKS[m.status] ?? m.status), m.error ? h("small", { class: "log-error", text: m.error }) : null)
          )
        )
      )
    )
  );
}

export async function renderInbox() {
  const data = await call("/api/admin/whatsapp/conversations");
  view.status = data.status;
  const toolbar = h(
    "div",
    { class: "toolbar" },
    segmented(
      [
        ["chats", "Chats"],
        ["log", "Sent messages"]
      ],
      view.mode,
      (value) => {
        view.mode = value;
        rerender();
      }
    ),
    h("span", { class: `chip ${data.status.active ? "chip-ok" : ""}`, text: data.status.active ? "Cloud API connected" : data.status.configured ? "Connected · switched off" : "Click-to-chat mode" })
  );
  const intro = data.status.active ? null : setupCard(data.status);
  if (view.mode === "log") return h("div", {}, toolbar, intro, await renderLog());

  const search = h("input", { type: "search", class: "admin-search", placeholder: "Search chats…", value: view.filter, "aria-label": "Search chats" });
  const list = h("div", { class: "convo-list" });
  const thread = h("section", { class: "thread" });
  view.els = { list, thread };
  search.addEventListener("input", () => {
    view.filter = search.value;
    drawList(data.conversations);
  });
  drawList(data.conversations);
  await drawThread();
  return h("div", {}, toolbar, intro, h("div", { class: "inbox" }, h("aside", { class: "inbox-side" }, search, list), thread));
}

/** Called by the dashboard's poll while the WhatsApp tab is open. */
export async function refreshInbox() {
  if (view.mode !== "chats" || !view.els?.list.isConnected) return;
  const data = await call("/api/admin/whatsapp/conversations");
  view.status = data.status;
  drawList(data.conversations);
  const typing = view.els.thread.querySelector("textarea");
  if (view.phone && !(typing && (typing.value || document.activeElement === typing))) await drawThread();
}
