import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/terms/index.html", import.meta.url), "utf8");

test("every in-page link on the terms page points to an existing section", () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id));
  const targets = [...html.matchAll(/href="#([\w-]+)"/g)].map(([, id]) => id);
  assert.ok(targets.length > 0);
  for (const target of targets) assert.ok(ids.has(target), `missing id="${target}"`);
});

test("terms sections are numbered in the same order as the table of contents", () => {
  const toc = [...html.matchAll(/<li><a href="#([^"]+)">/g)].map(([, id]) => id);
  const sections = [...html.matchAll(/<section id="([^"]+)" class="clause[^"]*">\s*<h2><span class="num">(\d+)<\/span>/g)];
  assert.deepEqual(sections.map(([, id]) => id), toc);
  sections.forEach(([, , number], index) => assert.equal(Number(number), index + 1));
});
