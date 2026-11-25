// Renders video.html frame by frame (deterministic: render(t) per frame), then ffmpeg makes the MP4.
//
//   node render.cjs frames OUT_DIR [FROM_FRAME] [TO_FRAME]   JPEG frames at 1920x1080, 25 fps
//   node render.cjs stills OUT_DIR 3,20.5,50                 PNG stills at those seconds (for checking)
//   VOICE_TIMING=voice/timing.json node render.cjs ...       fit scene lengths to the voice-over (narrate.py)
// OUT_DIR/timeline.json gets each scene's start and length (used by mix.py).
//
// Then: ffmpeg -framerate 25 -i OUT_DIR/f%05d.jpg -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart unity-carrier-tutorial.mp4
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FPS = 25;
const [mode, out, a, b] = process.argv.slice(2);

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    const boxes = JSON.parse(fs.readFileSync(path.join(__dirname, 'shots', 'boxes.json'), 'utf8'));
    // Voice-over timing (narrate.py): each scene lasts at least lead + narration + tail.
    const sceneMin = {};
    if (process.env.VOICE_TIMING) {
        const timing = JSON.parse(fs.readFileSync(process.env.VOICE_TIMING, 'utf8'));
        for (const [id, sc] of Object.entries(timing.scenes)) sceneMin[id] = sc.lead + sc.voice + sc.tail;
    }
    await page.addInitScript(([data, min]) => { window.BOXES = data; window.SCENE_MIN = min; }, [boxes, sceneMin]);
    page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
    await page.goto('file://' + path.join(__dirname, 'video.html'));
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    const duration = await page.evaluate(() => window.DURATION);
    fs.writeFileSync(path.join(out, 'timeline.json'), JSON.stringify(await page.evaluate(() => window.TIMELINE), null, 1));

    if (mode === 'stills') {
        for (const s of String(a).split(',')) {
            await page.evaluate((t) => window.render(t), Number(s));
            await page.screenshot({ path: path.join(out, `still-${s}.png`) });
        }
    } else {
        const total = Math.ceil(duration * FPS);
        const from = Number(a || 0);
        const to = Math.min(total, Number(b || total));
        for (let i = from; i < to; i++) {
            await page.evaluate((t) => window.render(t), i / FPS);
            await page.screenshot({ path: path.join(out, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
        }
        console.log(`frames ${from}-${to - 1} of ${total} (${duration}s)`);
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
