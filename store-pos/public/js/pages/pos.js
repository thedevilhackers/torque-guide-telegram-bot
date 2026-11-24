import { get, post } from "../api.js";
import { priceCart, promoLabel, settle } from "/shared/pricing.js";
import { editProduct } from "../product-form.js";
import { printReceipt } from "../print.js";
import { onScan, openCamera, scanField } from "../scanner.js";
import {
  $,
  askPin,
  beep,
  confirmDialog,
  currencyDecimals,
  dateTime,
  dayLabel,
  debounce,
  expiryBadge,
  html,
  icon,
  modal,
  money,
  mount,
  on,
  qty,
  showError,
  toMajor,
  toMinor,
  toast
} from "../ui.js";

const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const emptyCart = () => ({ lines: [], customer: null, bill_discount: null, age_verified: false, client_ref: newRef(), note: "" });

export default async function posPage(el, app) {
  const cartKey = `pos.cart.${app.branchId}`;
  let ctx;
  try {
    ctx = await get("/api/pos/context");
  } catch (err) {
    mount(el, html`<div class="banner danger">${icon("alert")} ${err.message}</div>`);
    return;
  }
  let cart = loadCart();
  let priced = null;
  let lineSeq = cart.lines.reduce((m, l) => Math.max(m, l.key), 0);
  let searchResults = [];
  let activeResult = -1;
  const methods = app.settings.payment_methods;
  const loyalty = app.settings.loyalty;

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(cartKey) || "null");
      if (saved && Array.isArray(saved.lines)) return { ...emptyCart(), ...saved };
    } catch {
      /* ignore */
    }
    return emptyCart();
  }
  function saveCart() {
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }

  // ---------- layout ----------
  mount(
    el,
    html`
      <div data-banners></div>
      <div class="pos">
        <section class="pos-left">
          <div class="card scanbar no-print" style="position:relative">
            ${scanField({ placeholder: "Scan barcode, or type PLU / product name  (F2)", id: "pos-scan" })}
            <div class="scan-results hidden" data-results role="listbox"></div>
          </div>
          <div class="card cart">
            <div class="card-head" style="padding-bottom:8px">
              <div class="row"><h2>Current sale</h2><span class="badge" data-count>0 items</span></div>
              <div data-customer></div>
            </div>
            <div class="cart-lines" data-lines></div>
            <div class="cart-foot no-print">
              <button class="btn sm" data-act="customer">${icon("user", 15)} Customer <kbd>F4</kbd></button>
              <button class="btn sm" data-act="discount">${icon("percent", 15)} Discount <kbd>F6</kbd></button>
              <button class="btn sm" data-act="hold">${icon("pause", 15)} Hold <kbd>F8</kbd></button>
              <button class="btn sm" data-act="recall">${icon("play", 15)} Recall <kbd>F9</kbd> <span class="badge" data-held>${ctx.held_count || ""}</span></button>
              <button class="btn sm" data-act="check">${icon("search", 15)} Price check <kbd>F10</kbd></button>
              <span class="grow"></span>
              <button class="btn sm danger" data-act="void">${icon("trash", 15)} Void sale</button>
            </div>
          </div>
        </section>
        <aside class="pos-right">
          <div class="card" data-quick-wrap>
            <div class="card-head" style="padding-bottom:0"><h3>Quick keys</h3><span class="faint small">${ctx.branch.name}</span></div>
            <div class="quick-keys" data-quick></div>
          </div>
          <div class="card">
            <div class="totals" data-totals></div>
            <div style="padding:0 16px 16px">
              <button class="btn primary lg" style="width:100%;min-height:64px;font-size:20px" data-act="pay">${icon("wallet", 22)} Pay <kbd>F12</kbd></button>
            </div>
          </div>
        </aside>
      </div>`
  );
  const scanInput = $("#pos-scan", el);
  const resultsEl = $("[data-results]", el);

  // ---------- rendering ----------
  function renderBanners() {
    const banners = [];
    if (ctx.branch.locked) banners.push(html`<div class="banner danger">${icon("lock")} <div><strong>This branch is locked by head office.</strong> ${ctx.branch.lock_reason}</div></div>`);
    if (app.settings.require_shift && !ctx.shift && app.me.user.kind !== "api") {
      banners.push(html`<div class="banner">${icon("clock")} <div class="grow"><strong>No open shift.</strong> Open a shift (count your starting cash) before selling.</div><button class="btn primary sm" data-act="open-shift">Open shift</button></div>`);
    }
    mount($("[data-banners]", el), html`${banners}`);
  }

  function renderQuickKeys() {
    const wrap = $("[data-quick-wrap]", el);
    if (!ctx.quick_keys.length) {
      wrap.classList.add("hidden");
      return;
    }
    mount(
      $("[data-quick]", el),
      html`${ctx.quick_keys.map(
        (p) => html`<button class="quick-key" data-quick-id="${p.id}"><strong>${p.name}</strong><span>${money(p.effective_price)}${p.sold_by_weight ? ` / ${p.unit}` : ""}</span></button>`
      )}`
    );
  }

  function reprice() {
    const lines = cart.lines.map((l) => ({ ...l, unit_price: l.price_override ?? l.unit_price }));
    priced = priceCart(lines, ctx.promotions, { taxInclusive: app.settings.prices_include_tax, billDiscount: cart.bill_discount });
  }

  function renderCart(flashKey) {
    reprice();
    saveCart();
    const linesEl = $("[data-lines]", el);
    if (!cart.lines.length) {
      mount(linesEl, html`<div class="empty">${icon("barcode", 40)}<div style="font-weight:600;color:var(--text-2)">Scan an item to start</div><div class="small">USB/Bluetooth scanners work anywhere on this screen. Or use the camera button.</div></div>`);
    } else {
      mount(
        linesEl,
        html`${priced.lines.map((l, i) => {
          const src = cart.lines[i];
          const lowStock = src.track_stock && src.stock_qty - src.expired_qty < l.qty;
          return html`<div class="cart-line ${src.key === flashKey ? "flash" : ""}" data-key="${src.key}">
            <div style="min-width:0">
              <div class="name ellipsis" data-act="edit-line" title="Edit line">${l.name}</div>
              <div class="meta">
                <span>${money(l.unit_price)}${l.sold_by_weight ? ` / ${src.unit}` : ""}</span>
                ${src.price_override !== null && src.price_override !== undefined ? html`<span class="badge warn">Price changed</span>` : ""}
                ${l.promo_name ? html`<span class="badge brand">${icon("tag", 12)} ${l.promo_name}</span>` : ""}
                ${l.manual_discount ? html`<span class="badge info">-${money(l.manual_discount)}</span>` : ""}
                ${src.min_age ? html`<span class="badge ${cart.age_verified ? "good" : "warn"}">${src.min_age}+ ${cart.age_verified ? "ID checked" : "ID check"}</span>` : ""}
                ${src.pack_expiry ? html`<span class="badge bad" title="Date read from the pack's barcode">${icon("alert", 12)} Pack expired ${dayLabel(src.pack_expiry, { day: "numeric", month: "short" })}</span>` : ""}
                ${!src.pack_expiry && lowStock && src.expired_qty > 0 ? html`<span class="badge bad">${icon("alert", 12)} Expired stock</span>` : !src.pack_expiry && lowStock ? html`<span class="badge warn">Low stock</span>` : ""}
              </div>
            </div>
            ${src.sold_by_weight
              ? html`<button class="btn sm" data-act="edit-line">${qty(l.qty, src.unit)}</button>`
              : html`<div class="stepper"><button data-act="dec" aria-label="Decrease">${icon("minus", 16)}</button><span data-act="edit-line">${qty(l.qty)}</span><button data-act="inc" aria-label="Increase">${icon("plus", 16)}</button></div>`}
            <div class="line-total">${l.discount ? html`<s>${money(l.gross)}</s>` : ""}${money(l.total)}</div>
            <button class="btn ghost icon sm" data-act="remove" aria-label="Remove ${l.name}">${icon("x", 16)}</button>
          </div>`;
        })}`
      );
      const flashed = flashKey && linesEl.querySelector(`[data-key="${flashKey}"]`);
      flashed?.scrollIntoView({ block: "nearest" });
    }
    $("[data-count]", el).textContent = `${qty(priced.items_count)} item${priced.items_count === 1 ? "" : "s"}`;
    renderCustomer();
    renderTotals();
  }

  function renderCustomer() {
    const c = cart.customer;
    mount(
      $("[data-customer]", el),
      c
        ? html`<div class="customer-pill">${icon("user", 16)}<div><strong>${c.name || c.phone}</strong> <span class="small muted">${c.phone ?? ""} · ${c.points} pts</span></div><button class="btn ghost icon sm" data-act="remove-customer" aria-label="Remove customer">${icon("x", 14)}</button></div>`
        : ""
    );
  }

  function renderTotals() {
    const p = priced;
    mount(
      $("[data-totals]", el),
      html`
        <div class="line"><span>Subtotal</span><span>${money(p.subtotal)}</span></div>
        ${p.discount_total ? html`<div class="line" style="color:var(--success)"><span>Discounts${cart.bill_discount ? ` (incl. bill ${cart.bill_discount.type === "percent" ? `${cart.bill_discount.value}%` : money(cart.bill_discount.value)})` : ""}</span><span>-${money(p.discount_total)}</span></div>` : ""}
        ${p.tax_breakdown.map((t) => html`<div class="line small"><span>Tax ${t.rate}%${app.settings.prices_include_tax ? " (included)" : ""}</span><span>${money(t.tax)}</span></div>`)}
        <div class="grand"><span style="font-weight:650">Total</span><strong data-total>${money(p.total)}</strong></div>`
    );
  }

  // ---------- adding items ----------
  async function askWeight(product) {
    const { result } = modal({
      title: `Weigh ${product.name}`,
      size: "sm",
      body: html`<form class="stack"><label class="field"><span>Weight (${product.unit})</span><input class="input num" name="w" type="number" step="0.001" min="0.001" required autofocus inputmode="decimal" /></label><p class="muted small">${money(product.effective_price)} per ${product.unit}</p></form>`,
      actions: [{ label: "Cancel" }, { label: "Add", kind: "primary", submit: true }],
      onSubmit: (form) => Number(form.w.value)
    });
    const w = await result;
    return w > 0 ? Math.round(w * 1000) / 1000 : null;
  }

  async function confirmAge(minAge) {
    const { result } = modal({
      title: `Age check: ${minAge}+`,
      size: "sm",
      body: html`<div class="banner">${icon("shield", 20)}<div><strong>Check the customer's ID.</strong><br />They must be at least ${minAge} years old to buy this item.</div></div>`,
      actions: [
        { label: "Not verified — remove", kind: "danger", value: false },
        { label: "ID checked, OK", kind: "primary", value: true }
      ]
    });
    return Boolean(await result);
  }

  async function confirmExpiredPack(product, expiry) {
    beep(false);
    const needsPin = !app.can("pos.sell_expired");
    const { result } = modal({
      title: "This pack has expired",
      size: "sm",
      body: html`<div class="banner danger">${icon("alert", 20)}<div><strong>${product.name}</strong><br />The barcode on this pack says it expired on <strong>${dayLabel(expiry)}</strong>. Take it off the shelf.</div></div>
        ${needsPin ? html`<p class="small muted" style="margin-top:10px">Selling it anyway needs a manager PIN at payment.</p>` : ""}`,
      actions: [
        { label: "Sell anyway", value: true },
        { label: "Don't sell", kind: "primary", value: false }
      ]
    });
    return Boolean(await result);
  }

  async function addProduct(product, addQty = 1, { source = "barcode", packExpiry = null } = {}) {
    if (!product.active || !product.branch_active) {
      beep(false);
      toast(`${product.name} is not for sale`, "error");
      return;
    }
    // Expiry read from the pack's own GS1 code: only kept on the line when it has passed.
    const expiredPack = packExpiry && packExpiry < ctx.today ? packExpiry : null;
    if (expiredPack && !(await confirmExpiredPack(product, expiredPack))) {
      toast(`${product.name} not added (expired pack)`, "warn");
      return;
    }
    let q = addQty;
    if (product.sold_by_weight && !["scale_weight", "scale_price"].includes(source)) {
      q = await askWeight(product);
      if (!q) return;
    }
    if (product.min_age > 0 && !cart.age_verified) {
      const ok = await confirmAge(product.min_age);
      if (!ok) {
        toast(`${product.name} not added (age not verified)`, "warn");
        return;
      }
      cart.age_verified = true;
    }
    let line = !product.sold_by_weight && cart.lines.find((l) => l.product_id === product.id && (l.price_override === null || l.price_override === undefined) && (l.pack_expiry ?? null) === expiredPack);
    if (line) line.qty = Math.round((line.qty + q) * 1000) / 1000;
    else {
      line = {
        key: ++lineSeq,
        product_id: product.id,
        category_id: product.category_id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        qty: q,
        unit_price: product.effective_price,
        price_override: null,
        manual_discount: 0,
        tax_rate: product.tax_rate,
        sold_by_weight: product.sold_by_weight,
        min_age: product.min_age,
        track_stock: product.track_stock,
        stock_qty: product.stock_qty,
        expired_qty: product.expired_qty,
        pack_expiry: expiredPack
      };
      cart.lines.push(line);
    }
    if (!expiredPack && product.track_stock && product.expired_qty > 0 && product.stock_qty - product.expired_qty < line.qty) {
      toast(`${product.name}: stock on record is expired — check the date on the pack`, "warn", 5000);
    }
    beep(true);
    renderCart(line.key);
  }

  async function handleCode(code) {
    hideResults();
    try {
      const hit = await get(`/api/lookup?code=${encodeURIComponent(code)}`);
      await addProduct(hit.product, hit.qty, { source: hit.source, packExpiry: hit.gs1?.pack_expiry });
    } catch (err) {
      if (err.code !== "UNKNOWN_BARCODE") return showError(err);
      const pack = err.details?.gs1;
      if (pack) {
        beep(false);
        if (!err.details.code) return toast("This is a shipping label with no product number. Scan the barcode on the item itself.", "error", 6000);
        return unknownBarcode(err.details.code);
      }
      // Not a code: try a name search.
      if (!/^\d{6,}$/.test(code)) {
        const { items } = await get(`/api/products?search=${encodeURIComponent(code)}&limit=8`);
        if (items.length === 1) return addProduct(items[0]);
        if (items.length) return showResults(items);
      }
      beep(false);
      unknownBarcode(code);
    }
  }

  async function unknownBarcode(code) {
    if (!app.can("catalog.edit")) {
      toast(`Barcode ${code} is not in the catalogue. Ask a manager to add it.`, "error", 5000);
      return;
    }
    const { result } = modal({
      title: "Unknown barcode",
      size: "sm",
      body: html`<p><span class="mono">${code}</span> isn't in your catalogue yet.</p>`,
      actions: [{ label: "Cancel" }, { label: "Add product", kind: "primary", value: true, icon: "plus" }]
    });
    if (!(await result)) return;
    const saved = await editProduct(app, null, { barcode: code });
    if (saved) addProduct(saved);
  }

  function showResults(items) {
    searchResults = items;
    activeResult = 0;
    resultsEl.classList.remove("hidden");
    mount(
      resultsEl,
      html`${items.map(
        (p, i) => html`<button type="button" role="option" class="${i === 0 ? "active" : ""}" data-result="${i}">
          <div class="grow" style="min-width:0"><div class="ellipsis" style="font-weight:600">${p.name}</div><div class="small faint">${p.barcode ?? p.sku} · stock ${qty(p.stock_qty, p.unit)}</div></div>
          <strong class="num">${money(p.effective_price)}</strong></button>`
      )}`
    );
  }
  function hideResults() {
    resultsEl.classList.add("hidden");
    searchResults = [];
    activeResult = -1;
  }

  const liveSearch = debounce(async (term) => {
    if (term.length < 2 || /^\d+$/.test(term)) return hideResults();
    try {
      const { items } = await get(`/api/products?search=${encodeURIComponent(term)}&limit=8`);
      if (scanInput.value.trim() === term) items.length ? showResults(items) : hideResults();
    } catch {
      /* ignore while typing */
    }
  }, 220);

  scanInput.addEventListener("input", () => liveSearch(scanInput.value.trim()));
  scanInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!searchResults.length) return;
      e.preventDefault();
      activeResult = (activeResult + (e.key === "ArrowDown" ? 1 : -1) + searchResults.length) % searchResults.length;
      [...resultsEl.children].forEach((b, i) => b.classList.toggle("active", i === activeResult));
      return;
    }
    if (e.key === "Escape") {
      scanInput.value = "";
      hideResults();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const value = scanInput.value.trim();
    if (searchResults.length && activeResult >= 0 && !/^\d+$/.test(value)) {
      addProduct(searchResults[activeResult]);
      scanInput.value = "";
      hideResults();
      return;
    }
    scanInput.value = "";
    if (value) handleCode(value);
  });
  on(resultsEl, "click", "[data-result]", (e, btn) => {
    addProduct(searchResults[Number(btn.dataset.result)]);
    scanInput.value = "";
    hideResults();
    scanInput.focus();
  });

  const stopScan = onScan((code) => handleCode(code));

  // ---------- line editing ----------
  function lineByEvent(target) {
    const key = Number(target.closest("[data-key]")?.dataset.key);
    return cart.lines.find((l) => l.key === key);
  }

  async function editLine(line) {
    const pricedLine = priced.lines[cart.lines.indexOf(line)];
    const { result } = modal({
      title: line.name,
      body: html`<form class="form-grid">
          <label class="field"><span>Quantity${line.sold_by_weight ? ` (${line.unit})` : ""}</span><input class="input num" name="qty" type="number" min="0.001" step="${line.sold_by_weight ? "0.001" : "1"}" value="${line.qty}" required autofocus /></label>
          <label class="field"><span>Unit price ${app.can("pos.price_override") ? "" : html`<small>(manager PIN)</small>`}</span><input class="input num" name="price" inputmode="decimal" value="${toMajor(line.price_override ?? line.unit_price)}" /></label>
          <label class="field"><span>Line discount (amount)</span><input class="input num" name="discount" inputmode="decimal" value="${line.manual_discount ? toMajor(line.manual_discount) : ""}" placeholder="0" /></label>
          <label class="field"><span>…or discount %</span><input class="input num" name="pct" type="number" min="0" max="100" step="0.5" placeholder="0" /></label>
          <div class="full small muted">Regular price ${money(line.unit_price)}${pricedLine?.promo_name ? ` · promotion: ${pricedLine.promo_name}` : ""}. Discounts over ${app.settings.max_cashier_discount_pct}% need a manager PIN at payment.</div>
        </form>`,
      actions: [
        { label: "Remove item", kind: "danger", value: "remove", icon: "trash" },
        { label: "Cancel" },
        { label: "Apply", kind: "primary", submit: true }
      ],
      onSubmit(form) {
        const q = Number(form.qty.value);
        if (!(q > 0)) throw new Error("Quantity must be more than zero");
        if (!line.sold_by_weight && !Number.isInteger(q) && !["kg", "g", "l", "ml"].includes(line.unit)) throw new Error("This item is sold in whole units");
        const price = toMinor(form.price.value);
        const gross = Math.round((Number.isFinite(price) ? price : line.unit_price) * q);
        let discount = toMinor(form.discount.value);
        const pct = Number(form.pct.value);
        if (pct > 0) discount = Math.round((gross * pct) / 100);
        return { qty: q, price, discount: Number.isFinite(discount) ? discount : 0 };
      }
    });
    const res = await result;
    if (res === "remove") {
      cart.lines = cart.lines.filter((l) => l !== line);
    } else if (res) {
      line.qty = res.qty;
      line.price_override = Number.isFinite(res.price) && res.price !== line.unit_price ? res.price : null;
      line.manual_discount = res.discount;
    } else return;
    renderCart(line.key);
  }

  on(el, "click", "[data-act]", async (e, target) => {
    const act = target.dataset.act;
    const line = lineByEvent(target);
    switch (act) {
      case "inc":
        line.qty += 1;
        return renderCart(line.key);
      case "dec":
        if (line.qty <= 1) cart.lines = cart.lines.filter((l) => l !== line);
        else line.qty -= 1;
        return renderCart();
      case "remove":
        cart.lines = cart.lines.filter((l) => l !== line);
        return renderCart();
      case "edit-line":
        return editLine(line);
      case "remove-customer":
        cart.customer = null;
        return renderCart();
      case "customer":
        return pickCustomer();
      case "discount":
        return billDiscount();
      case "hold":
        return hold();
      case "recall":
        return recall();
      case "check":
        return priceCheck();
      case "void":
        if (!cart.lines.length) return;
        if (await confirmDialog("Remove every item from this sale?", { title: "Void sale", ok: "Void sale", danger: true })) {
          cart = emptyCart();
          renderCart();
        }
        return;
      case "pay":
        return pay();
      case "open-shift":
        return openShiftDialog();
      default:
    }
  });
  on(el, "click", "[data-quick-id]", (e, btn) => {
    const product = ctx.quick_keys.find((p) => p.id === Number(btn.dataset.quickId));
    if (product) addProduct(product, 1, { source: "quick" });
  });
  on(el, "click", "[data-camera]", () => openCamera({ continuous: true, title: "Scan items" }));

  // ---------- customer, discount, hold/recall, price check ----------
  async function pickCustomer() {
    let found = [];
    const { result } = modal({
      title: "Customer & loyalty",
      body: html`<div class="stack">
        <div class="search">${icon("search")}<input class="input" data-q placeholder="Phone number or name" autofocus inputmode="search" /></div>
        <div data-list class="stack" style="gap:0"></div>
        <details><summary style="cursor:pointer;font-weight:600">New customer</summary>
          <form class="form-grid" style="margin-top:10px" data-new>
            <label class="field"><span>Phone</span><input class="input" name="phone" inputmode="tel" required /></label>
            <label class="field"><span>Name</span><input class="input" name="name" /></label>
            <button class="btn primary full" type="submit">${icon("plus", 16)} Add & attach</button>
          </form>
        </details></div>`,
      actions: [{ label: "Close" }],
      onMount(dialog, close) {
        const list = $("[data-list]", dialog);
        const draw = () =>
          mount(
            list,
            found.length
              ? html`<ul class="list-plain">${found.map((c, i) => html`<li><div><strong>${c.name || "—"}</strong><div class="small muted">${c.phone ?? ""} · ${c.points} pts · ${c.visits} visits</div></div><button class="btn sm primary" data-pick="${i}">Attach</button></li>`)}</ul>`
              : html`<p class="faint small">Type at least 3 characters.</p>`
          );
        draw();
        const search = debounce(async (term) => {
          found = term.length >= 3 ? await get(`/api/customers?search=${encodeURIComponent(term)}&limit=10`) : [];
          draw();
        }, 220);
        $("[data-q]", dialog).addEventListener("input", (e) => search(e.target.value.trim()));
        dialog.addEventListener("click", (e) => {
          const pick = e.target.closest("[data-pick]");
          if (pick) close(found[Number(pick.dataset.pick)]);
        });
        $("[data-new]", dialog).addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            const c = await post("/api/customers", { phone: e.target.phone.value, name: e.target.name.value });
            close(c);
          } catch (err) {
            showError(err);
          }
        });
      }
    });
    const customer = await result;
    if (customer?.id) {
      cart.customer = { id: customer.id, name: customer.name, phone: customer.phone, points: customer.points };
      renderCart();
      toast(`${customer.name || customer.phone} attached`, "success");
    }
  }

  async function billDiscount() {
    if (!cart.lines.length) return toast("Add items first");
    const current = cart.bill_discount;
    const { result } = modal({
      title: "Discount on whole bill",
      size: "sm",
      body: html`<form class="stack">
        <div class="seg"><label class="check" style="padding:8px 12px"><input type="radio" name="type" value="percent" ${current?.type !== "amount" ? "checked" : ""}/> Percent</label><label class="check" style="padding:8px 12px"><input type="radio" name="type" value="amount" ${current?.type === "amount" ? "checked" : ""}/> Amount</label></div>
        <label class="field"><span>Value</span><input class="input num" name="value" inputmode="decimal" autofocus value="${current ? (current.type === "amount" ? toMajor(current.value) : current.value) : ""}" /></label>
        <p class="small muted">Over ${app.settings.max_cashier_discount_pct}% needs a manager PIN at payment.</p>
      </form>`,
      actions: [{ label: "Remove discount", value: "clear" }, { label: "Apply", kind: "primary", submit: true }],
      onSubmit(form) {
        const type = form.type.value;
        const value = type === "amount" ? toMinor(form.value.value) : Number(form.value.value);
        if (!(value > 0)) throw new Error("Enter a discount");
        return { type, value };
      }
    });
    const res = await result;
    if (res === "clear") cart.bill_discount = null;
    else if (res) cart.bill_discount = res;
    else return;
    renderCart();
  }

  async function hold() {
    if (!cart.lines.length) return toast("Nothing to hold");
    const label = cart.customer?.name || `${cart.lines.length} lines · ${money(priced.total)}`;
    await post("/api/held-carts", { label, data: cart });
    cart = emptyCart();
    renderCart();
    ctx.held_count = (ctx.held_count || 0) + 1;
    $("[data-held]", el).textContent = ctx.held_count;
    toast("Sale put on hold", "success");
  }

  async function recall() {
    const held = await get("/api/held-carts");
    if (!held.length) return toast("No held sales");
    const { result } = modal({
      title: "Recall a held sale",
      body: html`<ul class="list-plain">${held.map(
        (h) => html`<li><div><strong>${h.label}</strong><div class="small muted">${h.user_name ?? ""} · ${dateTime(h.created_at)}</div></div><button class="btn sm primary" data-pick="${h.id}">Recall</button></li>`
      )}</ul>`,
      actions: [{ label: "Close" }],
      onMount(dialog, close) {
        dialog.addEventListener("click", (e) => {
          const b = e.target.closest("[data-pick]");
          if (b) close(Number(b.dataset.pick));
        });
      }
    });
    const id = await result;
    if (!id) return;
    if (cart.lines.length && !(await confirmDialog("The current sale will be put on hold first.", { title: "Swap sales", ok: "Continue" }))) return;
    if (cart.lines.length) await hold();
    const res = await post(`/api/held-carts/${id}/recall`);
    cart = { ...emptyCart(), ...res.data, client_ref: newRef() };
    lineSeq = cart.lines.reduce((m, l) => Math.max(m, l.key), 0);
    ctx.held_count = Math.max(0, (ctx.held_count || 1) - 1);
    $("[data-held]", el).textContent = ctx.held_count || "";
    renderCart();
  }

  async function priceCheck() {
    let restore;
    const { el: dialog, result } = modal({
      title: "Price check",
      body: html`<div class="stack"><div class="row">${scanField({ placeholder: "Scan or type", id: "pc-input" })}</div><div data-out><p class="faint">Scan an item to see its price, stock and expiry. Nothing is added to the sale.</p></div></div>`,
      actions: [{ label: "Close" }]
    });
    const out = $("[data-out]", dialog);
    const show = async (code) => {
      try {
        const hit = await get(`/api/lookup?code=${encodeURIComponent(code)}`);
        const p = hit.product;
        const promos = ctx.promotions.filter((pr) => pr.product_id === p.id || (pr.category_id && pr.category_id === p.category_id));
        mount(
          out,
          html`<div class="card card-pad stack"><h3>${p.name}</h3>
            <div style="font-size:34px;font-weight:700">${money(p.effective_price)}${p.sold_by_weight ? html`<span class="muted" style="font-size:16px"> / ${p.unit}</span>` : ""}</div>
            ${promos.map((pr) => html`<div><span class="badge brand">${icon("tag", 12)} ${pr.name} — ${promoLabel(pr, money)}</span></div>`)}
            <dl class="kv">${hit.gs1?.pack_expiry ? html`<dt>This pack</dt><dd>${expiryBadge(hit.gs1.pack_expiry, ctx.today)}${hit.gs1.batch ? html` <span class="small muted">batch ${hit.gs1.batch}</span>` : ""}</dd>` : ""}<dt>Stock here</dt><dd>${p.track_stock ? qty(p.stock_qty, p.unit) : "Not tracked"}</dd><dt>Next expiry</dt><dd>${expiryBadge(p.next_expiry, ctx.today)}</dd>
            ${p.expired_qty > 0 ? html`<dt>Expired on record</dt><dd><span class="badge bad">${qty(p.expired_qty, p.unit)}</span></dd>` : ""}
            <dt>Barcode</dt><dd class="mono">${p.barcode ?? "—"}</dd><dt>Category</dt><dd>${p.category_name ?? "—"}</dd></dl></div>`
        );
        beep(true);
      } catch (err) {
        beep(false);
        mount(out, html`<div class="banner danger">${err.message}</div>`);
      }
    };
    const input = $("#pc-input", dialog);
    input.focus();
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        e.preventDefault();
        show(input.value.trim());
        input.value = "";
      }
    });
    dialog.addEventListener("click", (e) => {
      if (e.target.closest("[data-camera]")) openCamera({ continuous: false, onCode: show, title: "Price check" });
    });
    restore = onScan(show);
    await result;
    restore();
    onScan((code) => handleCode(code));
  }

  async function openShiftDialog() {
    const { result } = modal({
      title: "Open shift",
      size: "sm",
      body: html`<form class="stack"><label class="field"><span>Starting cash in drawer</span><input class="input num" name="float" inputmode="decimal" placeholder="0.00" autofocus /></label>
        <label class="field"><span>Register</span><input class="input" name="register" value="POS-1" /></label></form>`,
      actions: [{ label: "Cancel" }, { label: "Open shift", kind: "primary", submit: true }],
      async onSubmit(form) {
        const amount = toMinor(form.float.value);
        const res = await post("/api/shifts/open", { opening_float: Number.isFinite(amount) ? amount : 0, register: form.register.value });
        return res;
      }
    });
    const res = await result;
    if (res) {
      ctx.shift = res.shift;
      await app.reloadMe();
      renderBanners();
      toast("Shift opened", "success");
      scanInput.focus();
    }
  }

  // ---------- payment ----------
  function cashSuggestions(due) {
    const unit = 10 ** currencyDecimals();
    const major = due / unit;
    const out = new Set([due]);
    for (const step of [1, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
      const v = Math.ceil(major / step) * step;
      if (v > major) out.add(Math.round(v * unit));
      if (out.size >= 5) break;
    }
    return [...out];
  }

  async function pay() {
    if (!cart.lines.length) return toast("Add items first");
    reprice();
    const total = priced.total;
    const payments = [];
    let method = methods[0].id;
    let redeem = 0;
    const customer = cart.customer;
    const canRedeem = customer && loyalty.enabled && loyalty.point_value > 0 && customer.points >= Math.max(loyalty.min_redeem, 1);

    const { el: dialog, close, result } = modal({
      title: "Payment",
      size: "lg",
      body: html`<div class="stack lg">
        <div class="pay-summary"><div><small>Total</small><strong>${money(total)}</strong></div><div class="due"><small>Remaining</small><strong data-due></strong></div><div class="change"><small>Change</small><strong data-change></strong></div></div>
        <div class="pay-methods">${methods.map((m) => html`<button type="button" class="btn ${m.id === method ? "active" : ""}" data-method="${m.id}">${icon(m.id === "cash" ? "cash" : m.id === "card" ? "wallet" : "scan", 18)} ${m.label}</button>`)}</div>
        <div class="row" style="align-items:flex-end">
          <label class="field grow"><span>Amount</span><input class="input num" style="font-size:22px;min-height:52px" data-amount inputmode="decimal" autofocus /></label>
          <label class="field" style="width:180px" data-ref-wrap><span>Reference <small>(optional)</small></span><input class="input" data-ref placeholder="Txn / last 4" /></label>
          <button type="button" class="btn lg" data-add-payment>${icon("plus", 18)} Add</button>
        </div>
        <div class="quick-cash" data-quick-cash></div>
        ${canRedeem
          ? html`<div class="banner info">${icon("wallet", 18)}<div class="grow"><strong>${customer.name || customer.phone}</strong> has ${customer.points} points (worth ${money(customer.points * loyalty.point_value)}).</div>
              <input class="input sm num" style="width:110px" data-points type="number" min="0" max="${customer.points}" placeholder="Points" /><button type="button" class="btn sm" data-use-points>Use</button></div>`
          : ""}
        <div data-pay-list></div>
      </div>`,
      actions: [
        { label: "Back to sale", value: null },
        { label: "Complete sale", kind: "primary", icon: "check", onClick: () => complete() }
      ]
    });
    const amountInput = $("[data-amount]", dialog);
    const completeBtn = dialog.querySelector('[data-action="1"]');

    function state() {
      const pointsValue = redeem * loyalty.point_value;
      const all = [...payments, ...(pointsValue ? [{ method: "points", amount: Math.min(pointsValue, total) }] : [])];
      return settle(total, all);
    }
    function draw() {
      const s = state();
      $("[data-due]", dialog).textContent = money(s.due);
      $("[data-change]", dialog).textContent = money(s.change);
      completeBtn.disabled = s.due > 0 || s.overpaidNonCash;
      completeBtn.style.minWidth = "180px";
      dialog.querySelectorAll("[data-method]").forEach((b) => b.classList.toggle("active", b.dataset.method === method));
      $("[data-ref-wrap]", dialog).classList.toggle("hidden", method === "cash");
      mount(
        $("[data-quick-cash]", dialog),
        method === "cash" && s.due > 0 ? html`${cashSuggestions(s.due).map((v, i) => html`<button type="button" class="btn ${i === 0 ? "primary" : ""}" data-cash="${v}">${i === 0 ? "Exact " : ""}${money(v)}</button>`)}` : ""
      );
      mount(
        $("[data-pay-list]", dialog),
        payments.length || redeem
          ? html`<table class="table"><tbody>${payments.map(
              (p, i) => html`<tr><td>${methods.find((m) => m.id === p.method)?.label ?? p.method} ${p.reference ? html`<span class="faint small">${p.reference}</span>` : ""}</td><td class="num">${money(p.amount)}</td><td style="width:40px"><button type="button" class="btn ghost icon sm" data-rm="${i}" aria-label="Remove payment">${icon("x", 14)}</button></td></tr>`
            )}${redeem ? html`<tr><td>Points (${redeem})</td><td class="num">${money(Math.min(redeem * loyalty.point_value, total))}</td><td><button type="button" class="btn ghost icon sm" data-rm-points aria-label="Remove points">${icon("x", 14)}</button></td></tr>` : ""}</tbody></table>`
          : ""
      );
      amountInput.placeholder = toMajor(s.due);
      if (s.overpaidNonCash) toast("Card/UPI cannot be more than the amount due", "error");
    }
    function addPayment(amount) {
      const s = state();
      if (!(amount > 0)) amount = s.due;
      if (!(amount > 0)) return;
      if (method !== "cash" && amount > s.due) amount = s.due;
      payments.push({ method, amount, reference: method === "cash" ? "" : $("[data-ref]", dialog).value.trim() });
      amountInput.value = "";
      $("[data-ref]", dialog).value = "";
      draw();
      if (state().due === 0) completeBtn.focus();
      else amountInput.focus();
    }

    dialog.addEventListener("click", (e) => {
      const m = e.target.closest("[data-method]");
      if (m) {
        method = m.dataset.method;
        draw();
        amountInput.focus();
      }
      const cash = e.target.closest("[data-cash]");
      if (cash) {
        method = "cash";
        addPayment(Number(cash.dataset.cash));
      }
      if (e.target.closest("[data-add-payment]")) addPayment(toMinor(amountInput.value));
      const rm = e.target.closest("[data-rm]");
      if (rm) {
        payments.splice(Number(rm.dataset.rm), 1);
        draw();
      }
      if (e.target.closest("[data-rm-points]")) {
        redeem = 0;
        draw();
      }
      if (e.target.closest("[data-use-points]")) {
        const pts = Math.min(Number($("[data-points]", dialog).value) || customer.points, customer.points, Math.ceil(total / loyalty.point_value));
        if (pts < loyalty.min_redeem) return toast(`Redeem at least ${loyalty.min_redeem} points`, "error");
        redeem = pts;
        draw();
      }
    });
    amountInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!amountInput.value && state().due === 0) return completeBtn.click();
      addPayment(toMinor(amountInput.value));
    });
    draw();

    async function complete(overridePin) {
      const s = state();
      if (s.due > 0) return false;
      completeBtn.disabled = true;
      const payload = {
        lines: cart.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price_override ?? undefined, discount: l.manual_discount || undefined, pack_expiry: l.pack_expiry || undefined })),
        payments,
        customer_id: cart.customer?.id,
        bill_discount: cart.bill_discount ?? undefined,
        redeem_points: redeem || undefined,
        age_verified: cart.age_verified,
        client_ref: cart.client_ref,
        override_pin: overridePin
      };
      try {
        const sale = await post("/api/pos/checkout", payload);
        close(sale);
        return sale;
      } catch (err) {
        completeBtn.disabled = false;
        if (err.code === "APPROVAL_REQUIRED") {
          const pin = await askPin({ reasons: err.details?.reasons ?? [] });
          if (pin) return complete(pin);
          return false;
        }
        if (err.code === "AGE_CHECK_REQUIRED") {
          if (await confirmAge(err.details?.min_age ?? 18)) {
            cart.age_verified = true;
            return complete(overridePin);
          }
          return false;
        }
        if (err.code === "NO_SHIFT") {
          close(null);
          openShiftDialog();
          return false;
        }
        showError(err);
        return false;
      }
    }

    const sale = await result;
    if (!sale || !sale.id) {
      scanInput.focus();
      return;
    }
    cart = emptyCart();
    renderCart();
    showReceipt(sale);
  }

  function receiptOptions() {
    return { storeName: app.settings.store_name, header: app.settings.receipt_header, methods, locale: app.settings.locale, timezone: ctx.branch.timezone };
  }

  function autoPrint() {
    try {
      return localStorage.getItem("pos.autoPrint") === "1";
    } catch {
      return false;
    }
  }

  async function showReceipt(sale) {
    if (autoPrint()) printReceipt(sale, receiptOptions());
    const { el: dialog, result } = modal({
      title: "Sale complete",
      size: "sm",
      body: html`<div class="stack" style="text-align:center">
        <div class="faint small">${sale.receipt_no}</div>
        ${sale.change_due ? html`<div><div class="muted">Change due</div><div style="font-size:52px;font-weight:750;color:var(--success);line-height:1.1">${money(sale.change_due)}</div></div>` : html`<div style="font-size:40px;font-weight:700">${money(sale.total)}</div><div class="muted">Paid in full</div>`}
        ${sale.customer ? html`<div class="badge info" style="justify-self:center">+${sale.points_earned} points · balance ${sale.customer.points}</div>` : ""}
        <label class="check" style="justify-content:center"><input type="checkbox" data-auto ${autoPrint() ? "checked" : ""}/> Print receipts automatically</label>
      </div>`,
      actions: [
        { label: "Print receipt", icon: "printer", value: "print" },
        { label: "New sale", kind: "primary", value: "new" }
      ]
    });
    $("[data-auto]", dialog).addEventListener("change", (e) => {
      try {
        localStorage.setItem("pos.autoPrint", e.target.checked ? "1" : "0");
      } catch {
        /* ignore */
      }
    });
    dialog.querySelector('[data-action="1"]').focus();
    const choice = await result;
    if (choice === "print") printReceipt(sale, receiptOptions());
    scanInput.focus();
  }

  // ---------- keyboard ----------
  const keys = (e) => {
    if (document.querySelector("dialog[open]")) return;
    const map = { F2: () => scanInput.focus(), F4: pickCustomer, F6: billDiscount, F8: hold, F9: recall, F10: priceCheck, F12: pay };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      pay();
    }
  };
  document.addEventListener("keydown", keys);

  renderBanners();
  renderQuickKeys();
  renderCart();
  scanInput.focus();

  return () => {
    document.removeEventListener("keydown", keys);
    stopScan();
  };
}

