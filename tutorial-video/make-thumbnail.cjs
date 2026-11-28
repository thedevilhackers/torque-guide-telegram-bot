// Renders thumbnail.html to thumbnail.jpg and thumbnail.png (1280x720, as YouTube recommends).
//   node make-thumbnail.cjs [OUT_DIR]
const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const out = process.argv[2] || __dirname;
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await page.goto('file://' + path.join(__dirname, 'thumbnail.html'));
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, 'thumbnail.png') });
    await page.screenshot({ path: path.join(out, 'thumbnail.jpg'), type: 'jpeg', quality: 92 });
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
