// Saves the blank card from unity-id-card.html as print files in brand/id-card/:
//   unity-id-card-blank.pdf     card size (54 × 85.6 mm), front on page 1, back on page 2
//   unity-id-card-blank-a4.pdf  A4, front and back side by side with corner marks for cutting
//   unity-id-card-front.png, unity-id-card-back.png  each side at 600 dpi
// Needs Playwright (https://playwright.dev), which the website itself doesn't use:
//   node brand/id-card/source/export.cjs
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

const folder = resolve(__dirname, "..");
const page = (query) => `${pathToFileURL(resolve(folder, "unity-id-card.html")).href}?${query}`;

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [layout, file] of [["card", "unity-id-card-blank.pdf"], ["a4", "unity-id-card-blank-a4.pdf"]]) {
      const tab = await browser.newPage();
      await tab.goto(page(`layout=${layout}`));
      await tab.evaluate(() => document.fonts.ready);
      await tab.pdf({ path: resolve(folder, file), preferCSSPageSize: true, printBackground: true });
      await tab.close();
    }
    // 600 dots per inch (a CSS pixel is 1/96 inch). Each picture is cut to the whole pixels inside
    // the card, so no page background shows along its edges.
    const scale = 600 / 96;
    const tab = await browser.newPage({ deviceScaleFactor: scale });
    await tab.goto(page("export"));
    await tab.evaluate(() => document.fonts.ready);
    for (const side of ["front", "back"]) {
      const box = await tab.locator(`.card--${side}`).boundingBox();
      const [left, top] = [Math.ceil(box.x * scale), Math.ceil(box.y * scale)];
      const [right, bottom] = [Math.floor((box.x + box.width) * scale), Math.floor((box.y + box.height) * scale)];
      const clip = { x: left / scale, y: top / scale, width: (right - left) / scale, height: (bottom - top) / scale };
      await tab.screenshot({ path: resolve(folder, `unity-id-card-${side}.png`), clip });
    }
  } finally {
    await browser.close();
  }
  console.log(`Saved the print files in ${folder}`);
})();
