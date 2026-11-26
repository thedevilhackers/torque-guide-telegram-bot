// node render.cjs review <outDir> [pages, e.g. 1,2,5]   → a PNG per page, plus an overflow report
// node render.cjs pdf <out.pdf> [print]                  → the PDF (print = with 3 mm bleed)
// BOOK=booklet-hi.html picks the Hindi edition.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const [mode, out, extra] = process.argv.slice(2);
  const src = path.join(__dirname, "src", process.env.BOOK || "booklet.html") + (mode === "pdf" && extra === "print" ? "?print=1" : "");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: mode === "review" ? 1.6 : 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("file://" + src);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  if (mode === "pdf") {
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  } else {
    const report = await page.evaluate(() => Array.from(document.querySelectorAll(".page")).map((p, i) => {
      const box = p.querySelector(".in").getBoundingClientRect();
      let bottom = 0;
      let right = 0;
      for (const el of p.querySelectorAll(".in *")) {
        const r = el.getBoundingClientRect();
        if (r.height && r.width) { bottom = Math.max(bottom, r.bottom); right = Math.max(right, r.right); }
      }
      return { n: i + 1, id: p.id, over: Math.round(bottom - box.bottom), overRight: Math.round(right - box.right) };
    }));
    // Figures deliberately hang 1 mm into the margins, so only a larger overhang counts on the right.
    for (const r of report) if (r.over > 0 || r.overRight > 9) console.log(`OVERFLOW p${r.n} ${r.id}: bottom +${r.over}px right +${r.overRight}px`);
    const cut = await page.evaluate(() => Array.from(document.querySelectorAll(".quip")).filter((q) => q.scrollWidth > q.clientWidth + 1).map((q) => q.dataset.id));
    if (cut.length) console.log("QUIP CUT OFF: " + cut.join(", "));
    const want = extra ? extra.split(",").map(Number) : null;
    const els = await page.locator(".page").all();
    for (let i = 0; i < els.length; i++) {
      if (!want || want.includes(i + 1)) await els[i].screenshot({ path: path.join(out, `p${String(i + 1).padStart(2, "0")}.png`) });
    }
  }
  console.log(errors.length ? "ERRORS: " + errors.join(" | ") : "no script errors");
  await browser.close();
})();
