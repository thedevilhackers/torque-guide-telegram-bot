import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { completeSetup } from "../src/api.js";
import { DEMO_LOGINS, DEMO_STORE } from "../src/demo.js";
import { createApp } from "../src/server.js";

const quiet = { log() {}, error() {} };
let app;
let base;

before(async () => {
  app = createApp({ dbPath: ":memory:", logger: quiet, demo: true });
  await completeSetup(app.db, DEMO_STORE);
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(() => {
  app.server.closeAllConnections();
  app.server.close();
  app.db.close();
});

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
};

test("public demo: sample store loaded, logins listed, and every listed login works", async () => {
  const setup = await call("GET", "/api/setup");
  assert.equal(setup.data.needs_setup, false);
  assert.deepEqual(setup.data.demo.logins, DEMO_LOGINS);
  for (const login of DEMO_LOGINS) {
    const res = await call("POST", "/api/auth/login", { username: login.username, pin: login.pin });
    assert.equal(res.status, 200, login.username);
  }
  const owner = await call("POST", "/api/auth/login", { username: "owner", password: DEMO_STORE.owner.password });
  const products = await call("GET", "/api/products?limit=1", undefined, owner.data.token);
  assert.ok(products.data.total > 10);
});

test("public demo: webhooks and changes to staff accounts are turned off", async () => {
  const { data } = await call("POST", "/api/auth/login", { username: "owner", password: DEMO_STORE.owner.password });
  const hook = await call("POST", "/api/webhooks", { url: "http://169.254.169.254/latest" }, data.token);
  assert.equal(hook.status, 403);
  assert.equal(hook.data.error.code, "DEMO_DISABLED");
  const users = await call("GET", "/api/users", undefined, data.token);
  const change = await call("PATCH", `/api/users/${users.data[0].id}`, { active: false }, data.token);
  assert.equal(change.data.error.code, "DEMO_DISABLED");
});
