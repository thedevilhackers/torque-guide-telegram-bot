import { call, emptyState, field, h, icon, input, onSubmit, openDialog, rerender, select, send, state, timeAgo, toast } from "./core.js";

const view = { auditUser: "" };
const permissionLabel = (key) => (key === "staff" ? "Staff & settings" : new Map(state.permissionCatalog).get(key) ?? key);

function permissionBoxes(selected, disabled) {
  return h(
    "fieldset",
    { class: "perm-grid", "data-field": "permissions", disabled },
    h("legend", { text: "What they can do" }),
    state.permissionCatalog.map(([key, label]) => h("label", { class: "check" }, h("input", { type: "checkbox", name: `perm-${key}`, value: key, checked: selected.includes(key) }), label))
  );
}

function readPermissions(form) {
  return [...form.querySelectorAll("input[name^=perm-]:checked")].map((box) => box.value);
}

/** Add or edit a staff account in a dialog. */
function staffDialog(roles, user = null) {
  const roleOptions = Object.entries(roles).map(([key, role]) => [key, role.label]);
  const roleSelect = select("role", roleOptions, user?.role ?? "frontdesk");
  const perms = permissionBoxes(user ? user.permissions : roles.frontdesk.permissions, (user?.role ?? "frontdesk") === "master");
  roleSelect.addEventListener("change", () => {
    const role = roles[roleSelect.value];
    perms.disabled = roleSelect.value === "master";
    perms.querySelectorAll("input").forEach((box) => (box.checked = role.permissions.includes(box.value)));
  });
  const form = h(
    "form",
    { novalidate: true, class: "staff-form" },
    h("div", { class: "field-row" }, field("Name", input("name", user?.name ?? "", { maxlength: "60", required: true })), user ? field("Username", input("username", user.username, { disabled: true })) : field("Username", input("username", "", { maxlength: "32", required: true, autocomplete: "off", placeholder: "e.g. raju" }))),
    h("div", { class: "field-row" }, field("Role", roleSelect), field(user ? "New password" : "Password", input("password", "", { type: "password", autocomplete: "new-password", minlength: "8", required: !user }), { hint: user ? "(leave empty to keep)" : "(at least 8 characters)" })),
    h("p", { class: "muted small", text: "Master accounts can do everything, including managing staff. For other roles, tick exactly what this person needs." }),
    perms,
    user ? h("label", { class: "check" }, h("input", { type: "checkbox", name: "active", checked: user.active }), "Account active (untick to block sign-in immediately)") : null,
    h("button", { type: "submit", class: "btn btn-primary btn-block" }, user ? "Save changes" : "Add staff member")
  );
  const dialog = openDialog(user ? `Edit ${user.name}` : "Add a staff member", form, { wide: true });
  onSubmit(form, async (values) => {
    const body = { name: values.name, role: values.role, permissions: readPermissions(form) };
    if (values.password) body.password = values.password;
    if (user) {
      body.active = Boolean(values.active);
      await call(`/api/admin/staff/${user.id}`, { method: "PATCH", body });
      toast(`${values.name} updated`);
    } else {
      await call("/api/admin/staff", { method: "POST", body: { ...body, username: values.username } });
      toast(`${values.name} can now sign in as @${values.username.toLowerCase()}`);
    }
    dialog.close();
    rerender();
  });
}

export async function renderStaff() {
  const [{ users, roles }, { entries }] = await Promise.all([call("/api/admin/staff"), call(`/api/admin/audit${view.auditUser ? `?user=${encodeURIComponent(view.auditUser)}` : ""}`)]);
  const table = h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "menu-table staff-table" },
      h("thead", {}, h("tr", {}, ["Name", "Role", "Can access", "Last sign-in", ""].map((label) => h("th", { text: label })))),
      h(
        "tbody",
        {},
        users.map((user) =>
          h(
            "tr",
            { class: user.active ? null : "is-off" },
            h("td", {}, h("div", { class: "name" }, h("span", { text: user.name }), user.id === state.me.id ? h("span", { class: "chip", text: "you" }) : null), h("div", { class: "desc", text: `@${user.username}` })),
            h("td", {}, h("span", { class: `chip ${user.role === "master" ? "chip-table" : ""}`, text: user.roleLabel }), user.active ? null : h("span", { class: "status-badge st-cancelled", text: "blocked" })),
            h("td", { class: "perm-chips" }, user.role === "master" ? h("span", { class: "muted", text: "Everything" }) : user.permissions.length ? user.permissions.map((p) => h("span", { class: "perm-chip", text: permissionLabel(p) })) : h("span", { class: "muted", text: "Nothing yet" })),
            h("td", { class: "muted", text: user.lastLoginAt ? timeAgo(user.lastLoginAt) : "Never" }),
            h(
              "td",
              { class: "nowrap" },
              h("button", { type: "button", class: "btn btn-sm btn-quiet", onclick: () => staffDialog(roles, user) }, "Edit"),
              user.id === state.me.id
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      class: "icon-btn icon-btn-sm",
                      "aria-label": `Delete ${user.name}`,
                      onclick: async () => {
                        if (!confirm(`Delete ${user.name}'s account? They will be signed out straight away.`)) return;
                        await send("DELETE", `/api/admin/staff/${user.id}`, undefined, `${user.name} removed`);
                        rerender();
                      }
                    },
                    icon("trash")
                  )
            )
          )
        )
      )
    )
  );

  const filter = select("auditUser", [["", "Everyone"], ...users.map((u) => [u.id, u.name]), ["master-key", "Master key"]], view.auditUser, { class: "admin-select", "aria-label": "Show activity for" });
  filter.addEventListener("change", () => {
    view.auditUser = filter.value;
    rerender();
  });

  return h(
    "div",
    { class: "stack" },
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Staff accounts", h("button", { type: "button", class: "btn btn-sm btn-primary", onclick: () => staffDialog(roles) }, icon("plus"), "Add staff")),
      h("p", { class: "muted", text: "Give each person their own login so the activity log shows who did what. Roles are a starting point: you can tick individual permissions for anyone." }),
      table,
      h(
        "div",
        { class: "role-guide" },
        Object.entries(roles).map(([key, role]) => h("div", {}, h("strong", { text: role.label }), h("span", { class: "muted", text: key === "master" ? "Everything, including staff, settings and WhatsApp setup." : role.permissions.map(permissionLabel).join(" · ") })))
      )
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Activity log", filter),
      entries.length
        ? h(
            "ol",
            { class: "audit-list" },
            entries.map((entry) =>
              h(
                "li",
                {},
                h("span", { class: "avatar", "aria-hidden": "true", text: entry.actorName.charAt(0).toUpperCase() }),
                h("div", {}, h("p", {}, h("strong", { text: entry.action })), entry.details ? h("p", { class: "muted", text: entry.details }) : null),
                h("p", { class: "audit-who" }, h("span", { text: entry.actorName }), h("time", { datetime: entry.at, title: new Date(entry.at).toLocaleString("en-IN"), text: timeAgo(entry.at) }))
              )
            )
          )
        : emptyState("No activity yet", "Changes made in the dashboard will be listed here.")
    )
  );
}
