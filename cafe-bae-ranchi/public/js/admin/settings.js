import { $, call, can, field, h, icon, input, onSubmit, rerender, select, send, showErrors, switchControl, textarea, toast } from "./core.js";

const view = { section: "business", tables: 12, showQr: false };
const SECTIONS = [
  ["business", "Business details"],
  ["website", "Website & features"],
  ["rules", "Hours & rules"],
  ["outlets", "Outlets"],
  ["whatsapp", "WhatsApp"],
  ["qr", "Table QR codes"]
];
const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const FEATURES = [
  ["ordering", "Online ordering", "Guests can order from the menu on the website."],
  ["dineIn", "Order from the table", "Table QR codes open the menu ready to order to that table."],
  ["pickup", "Pickup orders", "Guests can order ahead and collect at the counter."],
  ["bookings", "Table bookings", "Shows the reservation section with live availability."],
  ["enquiries", "Party enquiries", "Shows the birthdays & events form."],
  ["reviews", "Guest reviews", "Shows approved reviews and the review form."],
  ["newsletter", "Newsletter sign-up", "Shows the email sign-up box."]
];

/** Saves one section and maps "section.field" errors onto the form's fields. */
async function save(form, body, prefix, message) {
  try {
    const result = await call("/api/admin/settings", { method: "PATCH", body });
    toast(message);
    return result;
  } catch (error) {
    const fields = Object.fromEntries(Object.entries(error.fields ?? {}).map(([key, value]) => [prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key, value]));
    showErrors(form, { ...error, fields });
    throw error;
  }
}

function sectionForm(title, intro, children, submitLabel) {
  return h("form", { class: "panel settings-form", novalidate: true }, h("h2", { text: title }), intro ? h("p", { class: "muted", text: intro }) : null, children, h("div", { class: "form-actions" }, h("button", { type: "submit", class: "btn btn-primary" }, submitLabel)));
}

function bindSave(form, collect) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      await collect();
    } catch {
      /* errors already shown */
    } finally {
      button.disabled = false;
    }
  });
  form.addEventListener("input", (event) => {
    const holder = event.target.closest(".has-error");
    holder?.classList.remove("has-error");
    holder?.querySelector(".field-error")?.remove();
  });
  return form;
}

function businessSection(s) {
  const b = s.business;
  const a = b.address ?? {};
  const form = sectionForm(
    "Business details",
    "Shown across the website, in Google search results and in WhatsApp auto-replies.",
    [
      h("div", { class: "field-row" }, field("Cafe name", input("name", b.name, { maxlength: "60" })), field("City", input("city", b.city, { maxlength: "40" }))),
      field("Tagline", input("tagline", b.tagline, { maxlength: "120" })),
      field("Description", textarea("description", b.description, { maxlength: "300" }), { hint: "(for Google and link previews)" }),
      h("div", { class: "field-row" }, field("Phone", input("phone", b.phone, { maxlength: "20" })), field("WhatsApp number", input("whatsapp", b.whatsapp, { maxlength: "20" }), { hint: "(for the website's WhatsApp buttons)" })),
      h("div", { class: "field-row" }, field("Email", input("email", b.email, { type: "email", maxlength: "254" }), { hint: "(optional)" }), field("Instagram", input("instagram", b.instagram, { maxlength: "60", placeholder: "cafebae.ranchi" }), { hint: "(optional)" })),
      h("div", { class: "field-row" }, field("Website address", input("website", b.website, { maxlength: "200", placeholder: "https://www.cafebae.in" })), field("Approx. price for two (₹)", input("priceForTwo", b.priceForTwo, { type: "number", min: "0" }))),
      field("Street address", input("address.street", a.street, { maxlength: "160" })),
      h("div", { class: "field-row field-row-3" }, field("Area", input("address.locality", a.locality, { maxlength: "60" })), field("City", input("address.city", a.city, { maxlength: "40" })), field("PIN code", input("address.postalCode", a.postalCode, { maxlength: "10" }))),
      field("Map search text", input("mapsQuery", b.mapsQuery, { maxlength: "200" }), { hint: "(what Google Maps should search for)" })
    ],
    "Save business details"
  );
  return bindSave(form, async () => {
    const v = Object.fromEntries(new FormData(form).entries());
    await save(
      form,
      {
        business: {
          name: v.name,
          city: v.city,
          tagline: v.tagline,
          description: v.description,
          phone: v.phone,
          whatsapp: v.whatsapp,
          email: v.email,
          instagram: v.instagram,
          website: v.website,
          priceForTwo: v.priceForTwo === "" ? 0 : Number(v.priceForTwo),
          mapsQuery: v.mapsQuery,
          address: { street: v["address.street"], locality: v["address.locality"], city: v["address.city"], postalCode: v["address.postalCode"] }
        }
      },
      "business.",
      "Business details saved. The website is updated."
    );
  });
}

function websiteSection(s) {
  const features = h(
    "section",
    { class: "panel" },
    h("h2", { text: "Website features" }),
    h("p", { class: "muted", text: "Switch parts of the website on or off. Changes are live straight away, with no restart needed." }),
    h(
      "ul",
      { class: "feature-list" },
      FEATURES.map(([key, label, text]) =>
        h(
          "li",
          {},
          h("div", {}, h("strong", { text: label }), h("p", { class: "muted", text })),
          switchControl(s.features[key] !== false, label, async (on, el) => {
            try {
              await send("PATCH", "/api/admin/settings", { features: { [key]: on } }, `${label} ${on ? "switched on" : "switched off"}`);
            } catch {
              el.checked = !on;
            }
          })
        )
      )
    )
  );
  const announce = sectionForm(
    "Announcement bar",
    "A one-line message at the very top of the website. Leave empty to hide it.",
    [field("Announcement", textarea("announcement", s.announcement, { rows: "2", maxlength: "160" }))],
    "Save announcement"
  );
  bindSave(announce, () => save(announce, { announcement: announce.elements.announcement.value }, "announcement.", "Announcement updated on the website"));
  return h("div", { class: "stack" }, features, announce);
}

function rulesSection(s) {
  const hours = sectionForm(
    "Opening hours",
    "Controls the open/closed badge, when online ordering is available, and booking times. Times are IST.",
    [
      h(
        "div",
        { class: "hours-editor", "data-field": "hours" },
        DAYS.map(([key, label]) => {
          const entry = s.hours[key];
          const open = h("input", { type: "time", name: `${key}-open`, value: entry?.[0] ?? "10:00", "aria-label": `${label} opening time` });
          const close = h("input", { type: "time", name: `${key}-close`, value: entry?.[1] ?? "22:00", "aria-label": `${label} closing time` });
          const on = h("input", { type: "checkbox", name: `${key}-on`, checked: Boolean(entry) });
          const sync = () => (open.disabled = close.disabled = !on.checked);
          on.addEventListener("change", sync);
          sync();
          return h("div", { class: "hours-row" }, h("strong", { text: label }), h("label", { class: "check" }, on, "Open"), open, close);
        })
      )
    ],
    "Save hours"
  );
  bindSave(hours, () => {
    const els = hours.elements;
    return save(hours, { hours: Object.fromEntries(DAYS.map(([key]) => [key, els[`${key}-on`].checked ? [els[`${key}-open`].value, els[`${key}-close`].value] : null])) }, "", "Opening hours saved");
  });

  const r = s.reservations;
  const rules = sectionForm(
    "Ordering & booking rules",
    "",
    [
      h("h3", { class: "form-sub", text: "Orders" }),
      h(
        "div",
        { class: "field-row" },
        field("GST %", select("gstPercent", [0, 5, 12, 18].map((n) => [n, `${n}%`]), s.orders.gstPercent)),
        h("label", { class: "check check-field" }, h("input", { type: "checkbox", name: "acceptWhenClosed", checked: s.orders.acceptWhenClosed }), "Accept online orders outside opening hours")
      ),
      h("h3", { class: "form-sub", text: "Table bookings" }),
      h(
        "div",
        { class: "field-row field-row-3" },
        field("Seats per time slot", input("seatsPerSlot", r.seatsPerSlot, { type: "number", min: "1", max: "1000" })),
        field("Slot length", select("slotMinutes", [[15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"]], r.slotMinutes)),
        field("Largest online group", input("maxGuests", r.maxGuests, { type: "number", min: "1", max: "100" }))
      ),
      h(
        "div",
        { class: "field-row" },
        field("Bookable days ahead", input("daysAhead", r.daysAhead, { type: "number", min: "1", max: "180" })),
        field("Last seating before closing (minutes)", input("lastSeatingBeforeCloseMinutes", r.lastSeatingBeforeCloseMinutes, { type: "number", min: "0", max: "240" }))
      )
    ],
    "Save rules"
  );
  bindSave(rules, () => {
    const v = Object.fromEntries(new FormData(rules).entries());
    return save(
      rules,
      {
        orders: { gstPercent: Number(v.gstPercent), acceptWhenClosed: Boolean(v.acceptWhenClosed) },
        reservations: {
          seatsPerSlot: Number(v.seatsPerSlot),
          slotMinutes: Number(v.slotMinutes),
          maxGuests: Number(v.maxGuests),
          daysAhead: Number(v.daysAhead),
          lastSeatingBeforeCloseMinutes: Number(v.lastSeatingBeforeCloseMinutes)
        }
      },
      "",
      "Rules saved"
    );
  });
  return h("div", { class: "settings-grid" }, hours, rules);
}

function outletsSection(s) {
  const list = h("div", { class: "outlet-list" });
  const tones = s.options.tones.map((tone) => [tone, tone[0].toUpperCase() + tone.slice(1)]);
  const card = (outlet, index) =>
    h(
      "div",
      { class: "outlet-card" },
      h(
        "div",
        { class: "outlet-head" },
        h("strong", { text: `Outlet ${index + 1}` }),
        h("button", { type: "button", class: "btn btn-sm btn-quiet", onclick: (event) => (event.currentTarget.closest(".outlet-card").remove(), renumber()) }, icon("trash"), "Remove")
      ),
      h("div", { class: "field-row" }, field("Name", input(`outlets.${index}.name`, outlet.name, { maxlength: "60" })), field("Area", input(`outlets.${index}.area`, outlet.area, { maxlength: "40" }))),
      h("div", { class: "field-row" }, field("Label", input(`outlets.${index}.kind`, outlet.kind, { maxlength: "30", placeholder: "e.g. Open sky" })), field("Card colour", select(`outlets.${index}.tone`, tones, outlet.tone))),
      field("Description", textarea(`outlets.${index}.blurb`, outlet.blurb, { rows: "2", maxlength: "240" })),
      field("Address", input(`outlets.${index}.address`, outlet.address, { maxlength: "200" })),
      h("div", { class: "field-row" }, field("Hours", input(`outlets.${index}.hours`, outlet.hours, { maxlength: "80" })), field("Map search text", input(`outlets.${index}.mapsQuery`, outlet.mapsQuery, { maxlength: "200" })))
    );
  // Field names carry the index, so re-number after a removal to keep errors lined up.
  const renumber = () =>
    [...list.children].forEach((el, index) => {
      el.querySelector(".outlet-head strong").textContent = `Outlet ${index + 1}`;
      el.querySelectorAll("[name]").forEach((control) => {
        control.name = control.name.replace(/^outlets\.\d+\./, `outlets.${index}.`);
        control.closest("[data-field]")?.setAttribute("data-field", control.name);
      });
    });
  s.outlets.forEach((outlet, index) => list.append(card(outlet, index)));
  const form = sectionForm(
    "Outlets",
    "The “Three moods, one BAE” cards on the website. Add, edit or remove your spaces here.",
    [list, h("button", { type: "button", class: "btn btn-sm btn-quiet", onclick: () => list.append(card({ tone: "latte" }, list.children.length)) }, icon("plus"), "Add an outlet")],
    "Save outlets"
  );
  return bindSave(form, () => {
    const outlets = [...list.children].map((el, index) => {
      const get = (key) => el.querySelector(`[name="outlets.${index}.${key}"]`).value;
      return { name: get("name"), area: get("area"), kind: get("kind"), tone: get("tone"), blurb: get("blurb"), address: get("address"), hours: get("hours"), mapsQuery: get("mapsQuery") };
    });
    return save(form, { outlets }, "", "Outlets saved");
  });
}

async function whatsappSection() {
  const data = await call("/api/admin/whatsapp");
  const { status, settings, events } = data;
  const webhookUrl = `${location.origin}/api/whatsapp/webhook`;
  const statusPanel = h(
    "section",
    { class: "panel" },
    h("h2", { text: "Connection" }),
    h(
      "div",
      { class: "status-row" },
      h("span", { class: `chip ${status.configured ? "chip-ok" : "chip-warn"}`, text: status.configured ? `Cloud API connected · number ${status.phoneNumberId}` : "Cloud API not connected" }),
      h("span", { class: `chip ${status.webhookReady ? "chip-ok" : "chip-warn"}`, text: status.webhookReady ? "Webhook ready" : "Webhook not set up" }),
      h("span", { class: `chip ${status.active ? "chip-ok" : ""}`, text: status.active ? "Sending messages" : "Not sending" })
    ),
    status.configured
      ? null
      : h(
          "ol",
          { class: "steps" },
          h("li", { text: "Create a Meta developer app with the WhatsApp product and add your business phone number." }),
          h("li", { text: "On your server, set WHATSAPP_ACCESS_TOKEN (a permanent System User token), WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET and a WHATSAPP_VERIFY_TOKEN of your choice, then restart." }),
          h("li", { text: "In the Meta app's WhatsApp → Configuration, paste the webhook URL below with your verify token, and subscribe to “messages”." }),
          h("li", { text: "Create the message templates listed further down in WhatsApp Manager and wait for approval." })
        ),
    h("p", { class: "muted small", text: "Webhook URL for Meta:" }),
    h(
      "div",
      { class: "copy-row" },
      h("code", { text: webhookUrl }),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-quiet",
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(webhookUrl);
              toast("Webhook URL copied");
            } catch {
              toast("Couldn't copy. Select the URL and copy it manually.", { type: "error" });
            }
          }
        },
        "Copy"
      )
    )
  );

  const events_rows = Object.entries(events).map(([key, event]) => {
    const choice = settings.events[key] ?? { enabled: true, template: event.template };
    return h(
      "tr",
      {},
      h("td", {}, h("input", { type: "checkbox", name: `ev-${key}-on`, checked: choice.enabled, "aria-label": `Send ${event.label}` })),
      h(
        "td",
        {},
        h("strong", { text: event.label }),
        h(
          "details",
          { class: "template-help" },
          h("summary", { text: "Template text to create in WhatsApp Manager" }),
          h("p", { class: "template-sample", text: event.sample }),
          h("ol", {}, event.params.map((param) => h("li", { text: param })))
        )
      ),
      h("td", { "data-field": `whatsapp.events.${key}.template` }, h("input", { class: "inline-input mono", name: `ev-${key}-template`, value: choice.template, maxlength: "512", "aria-label": `Template name for ${event.label}` }))
    );
  });

  const form = sectionForm(
    "Automatic messages",
    "Staff alerts go to the numbers below. Guests only get updates if they tick “Send me updates on WhatsApp” on the website.",
    [
      h(
        "div",
        { class: "feature-list compact" },
        h("div", { class: "feature-item" }, h("div", {}, h("strong", { text: "Send WhatsApp messages" }), h("p", { class: "muted", text: "Master switch for alerts, guest updates and auto-replies." })), h("label", { class: "mini-switch" }, h("input", { type: "checkbox", name: "enabled", checked: settings.enabled, "aria-label": "Send WhatsApp messages" }), h("span", { class: "switch" }))),
        h("div", { class: "feature-item" }, h("div", {}, h("strong", { text: "Auto-reply to customers" }), h("p", { class: "muted", text: "Answers MENU, STATUS, BOOK, HOURS and LOCATION instantly, 24/7." })), h("label", { class: "mini-switch" }, h("input", { type: "checkbox", name: "autoReply", checked: settings.autoReply, "aria-label": "Auto-reply" }), h("span", { class: "switch" })))
      ),
      h(
        "div",
        { class: "field-row" },
        field("Staff numbers for alerts", textarea("staffNumbers", settings.staffNumbers.map((n) => `+${n}`).join("\n"), { rows: "3", placeholder: "+91 98765 43210\n+91 91234 56789" }), { name: "whatsapp.staffNumbers", hint: "(one per line, up to 10)" }),
        field("Template language code", input("language", settings.language, { maxlength: "10" }), { name: "whatsapp.language", hint: "(as approved in Meta, e.g. en)" })
      ),
      h("div", { class: "table-wrap" }, h("table", { class: "menu-table events-table" }, h("thead", {}, h("tr", {}, h("th", { text: "On" }), h("th", { text: "Message" }), h("th", { text: "Template name" }))), h("tbody", {}, events_rows)))
    ],
    "Save WhatsApp settings"
  );
  bindSave(form, async () => {
    const els = form.elements;
    const body = {
      enabled: els.enabled.checked,
      autoReply: els.autoReply.checked,
      language: els.language.value.trim(),
      staffNumbers: els.staffNumbers.value.split(/[\n,]+/).map((n) => n.trim()).filter(Boolean),
      events: Object.fromEntries(Object.keys(events).map((key) => [key, { enabled: els[`ev-${key}-on`].checked, template: els[`ev-${key}-template`].value.trim() }]))
    };
    try {
      await call("/api/admin/whatsapp/settings", { method: "PATCH", body });
      toast(body.enabled ? (status.configured ? "WhatsApp settings saved. Messages are on." : "Saved. Messages will start once the Cloud API is connected.") : "WhatsApp settings saved. Messages are off.");
      rerender();
    } catch (error) {
      showErrors(form, error);
    }
  });

  const test = h(
    "form",
    { class: "panel settings-form", novalidate: true },
    h("h2", { text: "Send a test message" }),
    h("p", { class: "muted", text: "Sends Meta's ready-made “hello_world” template to check the connection." }),
    h("div", { class: "inline-add" }, field("Phone number", input("phone", "", { placeholder: "+91 98765 43210", maxlength: "20", required: true })), h("button", { type: "submit", class: "btn btn-sm btn-primary", disabled: !status.configured }, icon("send"), "Send test"))
  );
  onSubmit(test, async (values) => {
    const { message } = await call("/api/admin/whatsapp/test", { method: "POST", body: values });
    if (message.status === "failed") throw Object.assign(new Error(`WhatsApp said: ${message.error}`), { fields: {} });
    toast("Test message sent. Check the phone!");
  });

  return h("div", { class: "stack" }, statusPanel, form, test);
}

function qrSection() {
  const count = input("tables", view.tables, { type: "number", min: "1", max: "60", class: "admin-search narrow", "aria-label": "Number of tables" });
  const links = () => Array.from({ length: view.tables }, (_, i) => ({ table: i + 1, url: `${location.origin}/?table=${i + 1}` }));
  const list = h("div", { class: "qr-grid" });
  const draw = () => {
    list.replaceChildren(
      ...links().map(({ table, url }) =>
        h(
          "div",
          { class: "qr-card" },
          view.showQr ? h("img", { src: `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(url)}`, alt: `QR code for table ${table}`, width: "180", height: "180", loading: "lazy" }) : null,
          h("strong", { text: `Table ${table}` }),
          h("code", { text: url })
        )
      )
    );
  };
  count.addEventListener("change", () => {
    view.tables = Math.max(1, Math.min(60, Number(count.value) || 12));
    draw();
  });
  draw();
  return h(
    "section",
    { class: "panel" },
    h("h2", { text: "Table QR codes" }),
    h("p", { class: "muted", text: "Each table gets its own link. Guests who scan it can order straight to that table, and the order shows the table number on the kitchen board and KOT." }),
    h(
      "div",
      { class: "toolbar" },
      h("label", { class: "inline-label" }, "Tables ", count),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-quiet",
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(links().map((l) => l.url).join("\n"));
              toast("Links copied");
            } catch {
              toast("Couldn't copy. Select the links and copy them manually.", { type: "error" });
            }
          }
        },
        "Copy links"
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-quiet",
          title: "QR images are generated by api.qrserver.com",
          onclick: () => {
            view.showQr = !view.showQr;
            draw();
          }
        },
        view.showQr ? "Hide QR codes" : "Show QR codes"
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-primary",
          onclick: () => {
            view.showQr = true;
            draw();
            const area = $("#printArea");
            area.replaceChildren(h("div", { class: "qr-print" }, list.cloneNode(true)));
            setTimeout(() => window.print(), 600);
          }
        },
        icon("print"),
        "Print QR sheet"
      )
    ),
    list
  );
}

export async function renderSettings() {
  const settings = await call("/api/admin/settings");
  const nav = h(
    "div",
    { class: "toolbar sub-nav" },
    h(
      "div",
      { class: "seg seg-scroll", role: "group" },
      SECTIONS.map(([key, label]) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": String(view.section === key),
            onclick: () => {
              view.section = key;
              rerender();
            }
          },
          label
        )
      )
    )
  );
  const sections = {
    business: () => businessSection(settings),
    website: () => websiteSection(settings),
    rules: () => rulesSection(settings),
    outlets: () => outletsSection(settings),
    whatsapp: () => (can("whatsapp") || can("settings") ? whatsappSection() : null),
    qr: () => qrSection()
  };
  return h("div", {}, nav, await sections[view.section]());
}
