import { $, $$, bag, bootPage, h, loadProducts, observeReveals, priceTag, productCard, productMedia, stockNote } from "./common.js";

const { site, openBag } = await bootPage();
const currency = site.settings.currency;
const grid = $("[data-products]");
const chips = $("[data-category-chips]");
const searchInput = $("[data-product-search]");
const sortSelect = $("[data-product-sort]");
const dialog = $("[data-product-dialog]");

let products = [];
let category = "All";

try {
  products = await loadProducts();
} catch (error) {
  grid.replaceChildren(h("p", { class: "empty-state", text: error.message }));
}

const SORTS = {
  featured: (a, b) => Number(b.featured) - Number(a.featured),
  "price-asc": (a, b) => a.price - b.price,
  "price-desc": (a, b) => b.price - a.price,
  name: (a, b) => a.name.localeCompare(b.name)
};

function visibleProducts() {
  const query = searchInput.value.trim().toLowerCase();
  return products
    .filter((product) => category === "All" || product.category === category)
    .filter((product) => !query || `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(query))
    .sort(SORTS[sortSelect.value] ?? SORTS.featured);
}

function render() {
  const list = visibleProducts();
  grid.replaceChildren(
    ...(list.length
      ? list.map((product, i) => productCard(product, currency, () => openProduct(product.id), Math.min(i, 8) * 0.05))
      : [h("p", { class: "empty-state", text: "Nothing matches that search." })])
  );
}

function renderChips() {
  const categories = ["All", ...new Set(products.map((product) => product.category))];
  chips.replaceChildren(
    ...categories.map((name) =>
      h("button", {
        class: "chip",
        type: "button",
        "aria-pressed": String(name === category),
        text: name,
        onclick: () => {
          category = name;
          for (const chip of $$(".chip", chips)) chip.setAttribute("aria-pressed", String(chip.textContent === name));
          render();
        }
      })
    )
  );
}

function openProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  let quantity = 1;
  const max = product.stock ?? 20;
  const output = h("output", { text: "1" });
  const setQuantity = (value) => {
    quantity = Math.max(1, Math.min(max, value));
    output.textContent = String(quantity);
  };
  const soldOut = product.stock === 0;
  const add = h("button", {
    class: "btn btn-primary",
    type: "button",
    disabled: soldOut,
    text: soldOut ? "Sold out" : "Add to bag",
    onclick: () => {
      bag.add(product.id, quantity);
      dialog.close();
      openBag();
    }
  });
  const close = h("button", { class: "icon-button sheet-close", type: "button", "aria-label": "Close", onclick: () => dialog.close() });
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  dialog.setAttribute("aria-label", product.name);
  dialog.replaceChildren(
    close,
    h(
      "div",
      { class: "product-detail" },
      productMedia(product),
      h(
        "div",
        { class: "product-body" },
        h("p", { class: "product-category", text: product.category }),
        h("h2", { text: product.name }),
        h("p", { class: "description", text: product.description }),
        product.features?.length ? h("ul", { class: "feature-list" }, ...product.features.map((feature) => h("li", { text: feature }))) : null,
        h("div", { class: "buy-row" }, priceTag(product, currency)),
        stockNote(product),
        h(
          "div",
          { class: "buy-row" },
          soldOut
            ? null
            : h("div", { class: "stepper" },
                h("button", { type: "button", "aria-label": "Decrease quantity", text: "−", onclick: () => setQuantity(quantity - 1) }),
                output,
                h("button", { type: "button", "aria-label": "Increase quantity", text: "+", onclick: () => setQuantity(quantity + 1) })
              ),
          add
        )
      )
    )
  );
  history.replaceState(null, "", `#${encodeURIComponent(product.id)}`);
  dialog.showModal();
}

dialog.addEventListener("close", () => history.replaceState(null, "", location.pathname));
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

let searchTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 120);
});
sortSelect.addEventListener("change", render);

renderChips();
render();
observeReveals();
if (location.hash.length > 1) openProduct(decodeURIComponent(location.hash.slice(1)));
