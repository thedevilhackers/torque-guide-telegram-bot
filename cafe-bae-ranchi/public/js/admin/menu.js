import { call, dietMark, field, h, icon, input, onSubmit, rerender, rupees, select, send, switchControl, toast } from "./core.js";

const view = { q: "", category: "all", showAdd: false, showCategories: false };
const ICONS = [["shake", "Shake"], ["coffee", "Coffee"], ["mocktail", "Mocktail"], ["fries", "Fries"], ["momo", "Momo"], ["pizza", "Pizza"], ["burger", "Burger"], ["cake", "Cake"]];
const TONES = [["blush", "Blush"], ["latte", "Latte"], ["sage", "Sage"], ["butter", "Butter"], ["peach", "Peach"], ["apricot", "Apricot"], ["honey", "Honey"], ["berry", "Berry"]];

function itemRow(item, categories, redraw, menu) {
  const price = h("input", { class: "price-input", type: "number", min: "0", max: "100000", step: "1", value: String(item.price), "aria-label": `Price for ${item.name}` });
  price.addEventListener("change", async () => {
    const value = Number(price.value);
    try {
      await send("PATCH", `/api/admin/menu/items/${item.id}`, { price: value }, `${item.name}: ${rupees(value)}`);
      item.price = value;
    } catch {
      price.value = String(item.price);
    }
  });
  const messages = {
    available: (on) => (on ? `${item.name} is back in stock` : `${item.name} marked sold out`),
    bestseller: (on) => (on ? `${item.name} added to bestsellers` : `${item.name} removed from bestsellers`),
    veg: (on) => `${item.name} marked ${on ? "veg" : "non-veg"}`
  };
  const toggle = (key, label) =>
    switchControl(key === "bestseller" ? Boolean(item.bestseller) : item[key] !== false, `${label}: ${item.name}`, async (on, el) => {
      try {
        await send("PATCH", `/api/admin/menu/items/${item.id}`, { [key]: on }, messages[key](on));
        item[key] = on;
        if (key !== "bestseller") redraw();
      } catch {
        el.checked = !on;
      }
    });
  return h(
    "tr",
    { class: item.available === false ? "is-off" : null },
    h("td", {}, h("div", { class: "name" }, dietMark(item.veg !== false), h("span", { text: item.name })), item.description ? h("div", { class: "desc", text: item.description }) : null),
    h("td", { text: categories.get(item.category)?.name ?? item.category }),
    h("td", {}, h("div", { class: "price-cell" }, "₹", price)),
    h("td", {}, toggle("available", "In stock")),
    h("td", {}, toggle("bestseller", "Bestseller")),
    h("td", {}, toggle("veg", "Veg")),
    h(
      "td",
      {},
      h(
        "button",
        {
          type: "button",
          class: "icon-btn icon-btn-sm",
          "aria-label": `Delete ${item.name}`,
          onclick: async () => {
            if (!confirm(`Delete "${item.name}" from the menu? This can't be undone.`)) return;
            await send("DELETE", `/api/admin/menu/items/${item.id}`, undefined, `${item.name} deleted`);
            menu.items.splice(menu.items.indexOf(item), 1);
            redraw();
          }
        },
        icon("trash")
      )
    )
  );
}

function addItemForm(menu, redraw) {
  const form = h(
    "form",
    { class: "add-form", novalidate: true },
    h("h2", { class: "span-4", text: "Add a menu item" }),
    field("Name", input("name", "", { maxlength: "60", required: true }), { className: "span-2" }),
    field("Category", select("category", menu.categories.map((c) => [c.id, c.name]), view.category !== "all" ? view.category : menu.categories[0]?.id)),
    field("Price (₹)", input("price", "", { type: "number", min: "0", step: "1", required: true })),
    field("Description", input("description", "", { maxlength: "200" }), { className: "span-4" }),
    field("Photo link", input("image", "", { maxlength: "500", placeholder: "https://… or /images/…" }), { hint: "(optional)", className: "span-2" }),
    h(
      "div",
      { class: "add-checks span-2" },
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "veg", checked: true }), "Vegetarian"),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "bestseller" }), "Bestseller"),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "spicy" }), "Spicy")
    ),
    h("div", { class: "span-4 add-actions" }, h("button", { type: "submit", class: "btn btn-primary" }, icon("plus"), "Add to menu"))
  );
  return onSubmit(form, async (values) => {
    const { item } = await call("/api/admin/menu/items", {
      method: "POST",
      body: {
        name: values.name,
        category: values.category,
        price: values.price === "" ? undefined : Number(values.price),
        description: values.description,
        image: values.image || undefined,
        veg: Boolean(values.veg),
        bestseller: Boolean(values.bestseller),
        spicy: Boolean(values.spicy)
      }
    });
    menu.items.push(item);
    toast(`${item.name} added to the menu`);
    form.reset();
    redraw();
  });
}

function categoriesPanel(menu) {
  const counts = new Map();
  for (const item of menu.items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const rows = menu.categories.map((category, index) => {
    const name = h("input", { class: "inline-input", value: category.name, maxlength: "40", "aria-label": "Category name" });
    const blurb = h("input", { class: "inline-input", value: category.blurb ?? "", maxlength: "120", "aria-label": "Category description" });
    const iconSelect = select("icon", ICONS, category.icon, { class: "mini-select", "aria-label": "Icon" });
    const toneSelect = select("tone", TONES, category.tone, { class: "mini-select", "aria-label": "Colour" });
    const save = (field) => async () => {
      const value = { name: name.value, blurb: blurb.value, icon: iconSelect.value, tone: toneSelect.value }[field];
      if (value === category[field]) return;
      await send("PATCH", `/api/admin/menu/categories/${category.id}`, { [field]: value }, "Category saved");
      category[field] = value;
    };
    name.addEventListener("change", save("name"));
    blurb.addEventListener("change", save("blurb"));
    iconSelect.addEventListener("change", save("icon"));
    toneSelect.addEventListener("change", save("tone"));
    const move = (direction) => async () => {
      await send("PATCH", `/api/admin/menu/categories/${category.id}`, { move: direction });
      rerender();
    };
    return h(
      "tr",
      {},
      h("td", {}, h("span", { class: `chip-icon tone-${category.tone}` }, icon(category.icon))),
      h("td", {}, name, blurb),
      h("td", {}, iconSelect, " ", toneSelect),
      h("td", { class: "muted", text: `${counts.get(category.id) ?? 0} items` }),
      h(
        "td",
        { class: "nowrap" },
        h("button", { type: "button", class: "icon-btn icon-btn-sm", "aria-label": `Move ${category.name} up`, disabled: index === 0, onclick: move("up") }, icon("up")),
        h("button", { type: "button", class: "icon-btn icon-btn-sm", "aria-label": `Move ${category.name} down`, disabled: index === menu.categories.length - 1, onclick: move("down") }, icon("down")),
        h(
          "button",
          {
            type: "button",
            class: "icon-btn icon-btn-sm",
            "aria-label": `Delete ${category.name}`,
            onclick: async () => {
              if (!confirm(`Delete the "${category.name}" category?`)) return;
              await send("DELETE", `/api/admin/menu/categories/${category.id}`, undefined, `${category.name} deleted`);
              rerender();
            }
          },
          icon("trash")
        )
      )
    );
  });
  const addForm = h(
    "form",
    { class: "inline-add", novalidate: true },
    field("New category", input("name", "", { maxlength: "40", required: true, placeholder: "e.g. Seasonal Specials" })),
    field("Icon", select("icon", ICONS, "shake")),
    field("Colour", select("tone", TONES, "blush")),
    h("button", { type: "submit", class: "btn btn-sm btn-primary" }, icon("plus"), "Add category")
  );
  onSubmit(addForm, async (values) => {
    await call("/api/admin/menu/categories", { method: "POST", body: values });
    toast(`${values.name} added`);
    rerender();
  });
  return h(
    "section",
    { class: "panel categories-panel" },
    h("h2", { text: "Menu categories" }),
    h("p", { class: "muted", text: "The order here is the order guests see on the website. A category can be deleted once it has no items." }),
    h("div", { class: "table-wrap" }, h("table", { class: "menu-table" }, h("tbody", {}, rows))),
    addForm
  );
}

export async function renderMenu() {
  const menu = await call("/api/admin/menu");
  const categories = new Map(menu.categories.map((c) => [c.id, c]));
  const tbody = h("tbody");
  const redraw = () => {
    const q = view.q.toLowerCase();
    const items = menu.items.filter((item) => (view.category === "all" || item.category === view.category) && (!q || `${item.name} ${item.description}`.toLowerCase().includes(q)));
    tbody.replaceChildren(...items.map((item) => itemRow(item, categories, redraw, menu)));
    if (!items.length) tbody.replaceChildren(h("tr", {}, h("td", { colspan: "7", class: "muted", text: "No items match." })));
  };
  redraw();

  const search = h("input", { class: "admin-search", type: "search", placeholder: "Search menu…", value: view.q, "aria-label": "Search menu" });
  search.addEventListener("input", () => {
    view.q = search.value;
    redraw();
  });
  const catSelect = select("category", [["all", "All categories"], ...menu.categories.map((c) => [c.id, c.name])], view.category, { class: "admin-select", "aria-label": "Category" });
  catSelect.addEventListener("change", () => {
    view.category = catSelect.value;
    redraw();
  });
  const addForm = addItemForm(menu, redraw);
  addForm.hidden = !view.showAdd;
  const cats = categoriesPanel(menu);
  cats.hidden = !view.showCategories;

  return h(
    "div",
    {},
    h(
      "div",
      { class: "toolbar" },
      search,
      catSelect,
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-quiet toolbar-end",
          "aria-expanded": String(view.showCategories),
          onclick: (event) => {
            view.showCategories = !view.showCategories;
            cats.hidden = !view.showCategories;
            event.currentTarget.setAttribute("aria-expanded", String(view.showCategories));
          }
        },
        icon("settings"),
        "Categories"
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-primary",
          onclick: () => {
            view.showAdd = !view.showAdd;
            addForm.hidden = !view.showAdd;
            if (view.showAdd) addForm.elements.name.focus();
          }
        },
        icon("plus"),
        "Add item"
      )
    ),
    cats,
    addForm,
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "menu-table" },
        h("thead", {}, h("tr", {}, ["Item", "Category", "Price", "In stock", "Bestseller", "Veg", ""].map((label) => h("th", { text: label })))),
        tbody
      )
    )
  );
}
