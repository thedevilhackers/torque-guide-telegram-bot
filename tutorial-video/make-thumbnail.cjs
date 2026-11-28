// Renders the thumbnails at 1280x720 (YouTube's recommended size):
//   thumbnail.html                  -> thumbnail.jpg (clean)
//   thumbnail-clickbait.html?v=a|b|c -> thumbnail-clickbait-a.jpg, -b.jpg, -c.jpg
//   node make-thumbnail.cjs [OUT_DIR]
const { chromium } = require('playwright');
const path = require('path');

(async () => {
    const out = process.argv[2] || __dirname;
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const jobs = [['thumbnail.html', 'thumbnail'], ['thumbnail-clickbait.html?v=a', 'thumbnail-clickbait-a'], ['thumbnail-clickbait.html?v=b', 'thumbnail-clickbait-b'], ['thumbnail-clickbait.html?v=c', 'thumbnail-clickbait-c']];
    for (const [file, name] of jobs) {
        await page.goto('file://' + path.join(__dirname, file));
        await page.waitForLoadState('load');
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(out, name + '.jpg'), type: 'jpeg', quality: 92 });
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
