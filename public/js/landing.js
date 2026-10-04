// Unity Performance home page: smooth scrolling and scroll animations, the drifting 3D car with
// exhaust flames and tyre smoke, the fire and ember effects, and the booking form.
// Runs as the site's home page (data-site="live" on <html>, details and photos from /api/site,
// bookings saved through /api/enquiries) and as the standalone file built by landing/build.mjs.

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SVG_NS = "http://www.w3.org/2000/svg";

const LIVE = document.documentElement.dataset.site === "live";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = matchMedia("(max-width: 760px)").matches;
const { gsap, ScrollTrigger, Lenis } = window;
const hasGsap = Boolean(gsap && ScrollTrigger);
const animate = hasGsap && !reduceMotion;
const formatNumber = new Intl.NumberFormat("en-IN");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const business = { whatsapp: "918709647229" };

// Old links to the previous home page (#car=…, #find, …) now live on /finder.
if (LIVE && /^#(car=|find|stage1|visit|work)/.test(location.hash)) location.replace(`/finder${location.hash}`);

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (parent) parent.appendChild(el);
  return el;
}

$$("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });

// ---------- One animation loop for every effect ----------
const tickers = new Set();
let scrollVelocity = 0;
let lastScrollY = window.scrollY;
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const y = window.scrollY;
  scrollVelocity = scrollVelocity * 0.85 + ((y - lastScrollY) / Math.max(dt, 0.001)) * 0.15;
  lastScrollY = y;
  for (const tick of tickers) tick(dt, now / 1000);
  requestAnimationFrame(frame);
}
if (!reduceMotion) requestAnimationFrame(frame);

// Runs fn while el is on screen.
function whileVisible(el, fn) {
  if (reduceMotion || !el) return;
  new IntersectionObserver(([entry]) => (entry.isIntersecting ? tickers.add(fn) : tickers.delete(fn)), { rootMargin: "120px" }).observe(el);
}

// ---------- Smooth scrolling and navigation ----------
let lenis = null;
if (hasGsap) {
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
}
if (!reduceMotion && Lenis) {
  lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
  if (hasGsap) {
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    tickers.add((dt, time) => lenis.raf(time * 1000));
  }
}

const nav = $(".nav");
const menu = $("#menu");
const toggle = $(".nav__toggle");
function setMenu(open) {
  menu.hidden = !open;
  nav.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  document.body.classList.toggle("menu-open", open);
  if (lenis) (open ? lenis.stop() : lenis.start());
  if (open) $("a", menu)?.focus();
}
toggle.addEventListener("click", () => setMenu(menu.hidden));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !menu.hidden) {
    setMenu(false);
    toggle.focus();
  }
});

$$('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href");
    const target = id === "#top" ? document.body : document.querySelector(id);
    if (!target) return;
    event.preventDefault();
    if (!menu.hidden) setMenu(false);
    if (lenis) lenis.scrollTo(id === "#top" ? 0 : target, { offset: id === "#top" ? 0 : -8 });
    else if (id === "#top") window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    else target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    if (id === "#main") {
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  });
});

const progress = $(".progress");
function onScroll() {
  nav.classList.toggle("is-solid", window.scrollY > 40);
  if (!animate) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
  }
}
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- Embers, drifting smoke, speed streaks and sparks behind the page ----------
function glowSprite(size, stops) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([at, color]) => gradient.addColorStop(at, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function smokeSprite(size, color) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 28; i += 1) {
    const radius = size * (0.1 + Math.random() * 0.22);
    const x = size / 2 + (Math.random() - 0.5) * size * 0.42;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.42;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${color}, 0.2)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function createFx(canvas) {
  const ctx = canvas.getContext("2d");
  const scale = Math.min(window.devicePixelRatio || 1, 1.5);
  const ember = glowSprite(64, [[0, "rgba(255,246,220,1)"], [0.18, "rgba(255,190,80,0.95)"], [0.45, "rgba(255,90,20,0.35)"], [1, "rgba(255,40,10,0)"]]);
  const smoke = smokeSprite(256, "205,190,182");
  let width = 0;
  let height = 0;
  const embers = [];
  const puffs = [];
  const streaks = [];
  const sparks = [];

  const newEmber = (anywhere) => ({
    x: Math.random() * width,
    y: anywhere ? Math.random() * height : height + 12,
    vx: (Math.random() - 0.5) * 24,
    vy: -(26 + Math.random() * 74),
    size: 1 + Math.random() * 2.4,
    phase: Math.random() * 6.28,
    age: 0,
    life: 5 + Math.random() * 7
  });
  const newPuff = (anywhere) => {
    const size = (0.5 + Math.random() * 0.6) * Math.max(width, height);
    return {
      size,
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : height + size * 0.3,
      vx: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 10),
      vy: -(3 + Math.random() * 8),
      alpha: 0.05 + Math.random() * 0.05
    };
  };

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);
  for (let i = 0; i < (phone ? 34 : 70); i += 1) embers.push(newEmber(true));
  for (let i = 0; i < (phone ? 4 : 7); i += 1) puffs.push(newPuff(true));

  function draw(dt, time) {
    ctx.clearRect(0, 0, width, height);
    const velocity = clamp(scrollVelocity, -4000, 4000);

    ctx.globalCompositeOperation = "source-over";
    puffs.forEach((puff, i) => {
      puff.x += puff.vx * dt;
      puff.y += (puff.vy - velocity * 0.03) * dt;
      if (puff.x < -puff.size || puff.x > width + puff.size || puff.y < -puff.size || puff.y > height + puff.size) puffs[i] = newPuff(false);
      ctx.globalAlpha = puff.alpha;
      ctx.drawImage(smoke, puff.x - puff.size / 2, puff.y - puff.size / 2, puff.size, puff.size);
    });

    ctx.globalCompositeOperation = "lighter";
    embers.forEach((e, i) => {
      e.age += dt;
      e.x += (e.vx + Math.sin(time * 1.4 + e.phase) * 20) * dt;
      e.y += (e.vy - velocity * 0.14) * dt;
      if (e.age > e.life || e.y < -30 || e.y > height + 60) {
        embers[i] = newEmber(false);
        return;
      }
      const fade = Math.min(1, e.age / 0.6, (e.life - e.age) / 1.2);
      ctx.globalAlpha = fade * (0.55 + 0.45 * Math.sin(time * 9 + e.phase * 3));
      const s = e.size * 8;
      ctx.drawImage(ember, e.x - s / 2, e.y - s / 2, s, s);
    });

    const speed = Math.abs(velocity);
    if (speed > 700) {
      for (let i = 0; i < Math.min(6, (speed - 700) / 350); i += 1) {
        streaks.push({ x: Math.random() * width, y: Math.random() * height, length: 60 + Math.random() * 200 * Math.min(2, speed / 1500), vy: -Math.sign(velocity) * (900 + speed * 0.8), age: 0, life: 0.25 + Math.random() * 0.2, hot: Math.random() < 0.35 });
      }
    }
    for (let i = streaks.length - 1; i >= 0; i -= 1) {
      const s = streaks[i];
      s.age += dt;
      s.y += s.vy * dt;
      if (s.age > s.life) {
        streaks.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = (1 - s.age / s.life) * 0.35;
      ctx.fillStyle = s.hot ? "#ff8a2a" : "#ffffff";
      ctx.fillRect(s.x, s.y, 1.5, s.length);
    }

    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const k = sparks[i];
      k.age += dt;
      k.vy += 900 * dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      if (k.age > k.life) {
        sparks.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = 1 - k.age / k.life;
      const s = k.size * (1 - (k.age / k.life) * 0.5);
      ctx.drawImage(ember, k.x - s / 2, k.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  return {
    draw,
    burst(x, y, count = 16) {
      for (let i = 0; i < count && sparks.length < 260; i += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const speed = 180 + Math.random() * 420;
        sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 10 + Math.random() * 22, age: 0, life: 0.45 + Math.random() * 0.5 });
      }
    }
  };
}

const fxCanvas = $(".fx");
const fx = !reduceMotion && fxCanvas ? createFx(fxCanvas) : { draw() {}, burst() {} };
if (!reduceMotion) tickers.add((dt, time) => fx.draw(dt, time));

// ---------- Walls of fire (the classic spreading-fire effect, drawn small and scaled up) ----------
function firePalette(levels) {
  const stops = [
    [0, [0, 0, 0, 0]], [0.11, [40, 4, 2, 80]], [0.25, [110, 12, 4, 170]], [0.39, [190, 30, 8, 220]], [0.53, [235, 70, 12, 245]],
    [0.67, [255, 120, 25, 255]], [0.8, [255, 175, 50, 255]], [0.92, [255, 222, 120, 255]], [1, [255, 248, 220, 255]]
  ];
  const bytes = new Uint8ClampedArray((levels + 1) * 4);
  for (let i = 0; i <= levels; i += 1) {
    const t = i / levels;
    const upper = stops.findIndex(([at]) => at >= t);
    const [a, ca] = stops[Math.max(0, upper - 1)];
    const [b, cb] = stops[upper];
    const k = b === a ? 0 : (t - a) / (b - a);
    for (let c = 0; c < 4; c += 1) bytes[i * 4 + c] = ca[c] + (cb[c] - ca[c]) * k;
  }
  return new Uint32Array(bytes.buffer);
}

function fireWall(canvas, { cols, rows, reach = 0.8, strength = 1 }) {
  const LEVELS = 36;
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(cols, rows);
  const pixels = new Uint32Array(image.data.buffer);
  const palette = firePalette(LEVELS);
  const heat = new Uint8Array(cols * rows);
  const decay = LEVELS / (rows * reach);
  let flare = 0;
  let clock = 0;
  let pending = 0;

  function step(level) {
    const base = (rows - 1) * cols;
    for (let x = 0; x < cols; x += 1) {
      // Gaps in the fuel line split the fire into separate tongues of flame.
      heat[base + x] = Math.random() < 0.28 ? 0 : Math.round(LEVELS * Math.min(1, level * (0.75 + Math.random() * 0.25)));
    }
    for (let y = 1; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const src = y * cols + x;
        const value = heat[src];
        if (value === 0) {
          heat[src - cols] = 0;
          continue;
        }
        const dst = src - cols - ((Math.random() * 3) | 0) + 1;
        if (dst >= 0) heat[dst] = Math.max(0, value - (Math.random() < decay ? 1 : 0));
      }
    }
  }
  function paint() {
    for (let i = 0; i < heat.length; i += 1) pixels[i] = palette[heat[i]];
    ctx.putImageData(image, 0, 0);
  }
  for (let i = 0; i < rows * 1.5; i += 1) step(strength);
  paint();

  return {
    flare(amount = 1) { flare = Math.max(flare, amount); },
    tick(dt) {
      clock += dt;
      pending += dt;
      flare *= Math.exp(-dt * 3);
      if (pending < 1 / 30) return;
      pending = 0;
      const level = strength * (0.82 + 0.1 * Math.sin(clock * 1.7) + 0.08 * Math.sin(clock * 4.3)) + flare * 0.35;
      step(level);
      paint();
    }
  };
}

const heroFireCanvas = $(".hero__fire");
// The hero's flat fire is a stand-in: once the 3D scene is running it has its own flames.
let heroFire = heroFireCanvas ? fireWall(heroFireCanvas, phone ? { cols: 110, rows: 70, reach: 0.7 } : { cols: 170, rows: 90, reach: 0.7 }) : null;
if (heroFire) whileVisible($(".hero"), (dt) => heroFire?.tick(dt));
const footerFireCanvas = $(".footer__fire");
const footerFire = footerFireCanvas ? fireWall(footerFireCanvas, phone ? { cols: 110, rows: 56, reach: 0.8 } : { cols: 220, rows: 70, reach: 0.8 }) : null;
if (footerFire) whileVisible($(".footer"), (dt) => footerFire.tick(dt));

// ---------- Hero power readout: the burnout builds from stock to tuned ----------
const STOCK_HP = 115;
const TUNED_HP = 140;
const SCALE_HP = 150;
const hud = { hp: $(".hud__hp"), fill: $(".hud__fill"), gain: $(".hud__gain") };
const burnout = { level: reduceMotion ? 1 : 0, started: performance.now() / 1000 };
function showBurnout(level) {
  const hp = Math.round(STOCK_HP + (TUNED_HP - STOCK_HP) * level);
  hud.hp.textContent = hp;
  hud.fill.style.width = `${(hp / SCALE_HP) * 100}%`;
  hud.gain.textContent = `+${hp - STOCK_HP} HP over stock`;
}
showBurnout(burnout.level);
if (!reduceMotion) {
  const ramp = (dt, time) => {
    const t = clamp((time - burnout.started - 0.8) / 4.2, 0, 1);
    burnout.level = 1 - Math.pow(1 - t, 2.2);
    showBurnout(burnout.level);
    if (t >= 1) tickers.delete(ramp);
  };
  tickers.add(ramp);
}

// ---------- Rev counter and power meter ----------
const GAUGE = { cx: 200, cy: 200, max: 8000, start: -135, end: 135, redline: 6500, limiter: 7300 };
const POWER = {
  rpm: [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500],
  stock: [30, 52, 70, 84, 96, 103, 109, 113, 115, 112, 104],
  tuned: [36, 66, 86, 101, 113, 123, 131, 137, 140, 136, 126]
};
const angleFor = (rpm) => GAUGE.start + (rpm / GAUGE.max) * (GAUGE.end - GAUGE.start);
const polar = (radius, deg) => {
  const rad = (deg * Math.PI) / 180;
  return [GAUGE.cx + radius * Math.sin(rad), GAUGE.cy - radius * Math.cos(rad)];
};
const arcPath = (radius, from, to) => {
  const [x1, y1] = polar(radius, from);
  const [x2, y2] = polar(radius, to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};
// Tuned power at an engine speed, holding the peak once it is reached.
function tunedPowerAt(rpm) {
  const r = Math.min(rpm, 5500);
  if (r < POWER.rpm[0]) return POWER.tuned[0] * clamp((r - 800) / (POWER.rpm[0] - 800), 0, 1);
  const i = Math.max(0, POWER.rpm.findIndex((value) => value >= r) - 1);
  const k = (r - POWER.rpm[i]) / (POWER.rpm[i + 1] - POWER.rpm[i] || 1);
  return POWER.tuned[i] + (POWER.tuned[i + 1] - POWER.tuned[i]) * clamp(k, 0, 1);
}

$(".gauge__track").setAttribute("d", arcPath(170, GAUGE.start, GAUGE.end));
$(".gauge__fill").setAttribute("d", arcPath(170, GAUGE.start, GAUGE.end));
$(".gauge__redzone").setAttribute("d", arcPath(156, angleFor(GAUGE.redline), GAUGE.end));
const ticks = $(".gauge__ticks");
for (let rpm = 0; rpm <= GAUGE.max; rpm += 250) {
  const major = rpm % 1000 === 0;
  const half = rpm % 500 === 0;
  const angle = angleFor(rpm);
  const [x1, y1] = polar(162, angle);
  const [x2, y2] = polar(major ? 140 : half ? 148 : 154, angle);
  const kind = rpm >= GAUGE.redline ? " gauge__tick--red" : major || half ? "" : " gauge__tick--minor";
  svg("line", { x1, y1, x2, y2, class: `gauge__tick${kind}`, "stroke-width": major ? 4 : half ? 2.5 : 1.5 }, ticks);
}
const nums = $(".gauge__nums");
for (let k = 0; k <= 8; k += 1) {
  const [x, y] = polar(118, angleFor(k * 1000));
  svg("text", { x, y, class: `gauge__num${k * 1000 >= 7000 ? " gauge__num--red" : ""}` }, nums).textContent = k;
}

const gauge = {
  root: $(".gauge"),
  needle: $(".gauge__needle"),
  fill: $(".gauge__fill"),
  readout: $(".gauge__rpm"),
  leds: $$(".led"),
  steps: $$(".rev__steps [data-rpm]"),
  hp: $(".hp-meter__value"),
  hpFill: $(".hp-meter__fill"),
  hpNote: $(".hp-meter__note"),
  limitSince: 0
};
const fillLength = gauge.fill.getTotalLength();
gauge.fill.style.strokeDasharray = `${fillLength} ${fillLength}`;
function setRpm(rpm) {
  gauge.needle.setAttribute("transform", `rotate(${angleFor(rpm).toFixed(2)} 200 200)`);
  gauge.fill.style.strokeDashoffset = String(fillLength * (1 - rpm / GAUGE.max));
  gauge.readout.textContent = formatNumber.format(Math.round(rpm / 10) * 10);
  const lit = clamp(Math.floor((rpm - 4700) / 240), 0, 10);
  gauge.leds.forEach((led, index) => led.classList.toggle("is-on", index < lit));
  gauge.steps.forEach((step) => step.classList.toggle("is-on", rpm >= Number(step.dataset.rpm)));
  gauge.root.style.setProperty("--heat", (rpm / GAUGE.max) ** 2);
  const hp = Math.round(tunedPowerAt(rpm));
  gauge.hp.textContent = hp;
  gauge.hpFill.style.width = `${(hp / SCALE_HP) * 100}%`;
  gauge.hpNote.textContent = hp > STOCK_HP ? `+${hp - STOCK_HP} HP over the stock peak` : "Stock peak 115 HP · Tuned 140 HP";
  const limit = rpm >= GAUGE.limiter;
  if (limit !== gauge.root.classList.contains("is-limit")) gauge.root.classList.toggle("is-limit", limit);
}
setRpm(animate ? 850 : 7000);
// At the limiter the gauge throws sparks.
whileVisible(gauge.root, (dt) => {
  if (!gauge.root.classList.contains("is-limit")) return;
  gauge.limitSince += dt;
  if (gauge.limitSince < 0.28) return;
  gauge.limitSince = 0;
  const box = $(".gauge__svg").getBoundingClientRect();
  fx.burst(box.left + box.width / 2, box.top + box.height * 0.86, 14);
});

// ---------- Power graph ----------
const CHART = { left: 58, right: 620, top: 26, bottom: 356, rpmMin: 1000, rpmMax: 7000, hpMax: 160 };
const chartX = (rpm) => CHART.left + ((rpm - CHART.rpmMin) / (CHART.rpmMax - CHART.rpmMin)) * (CHART.right - CHART.left);
const chartY = (hp) => CHART.bottom - (hp / CHART.hpMax) * (CHART.bottom - CHART.top);
function smoothPath(points) {
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
const gridLines = $(".pw-gridlines");
for (let hp = 0; hp <= CHART.hpMax; hp += 40) {
  svg("line", { x1: CHART.left, x2: CHART.right, y1: chartY(hp), y2: chartY(hp), class: "pw-grid" }, gridLines);
  svg("text", { x: CHART.left - 12, y: chartY(hp) + 4, "text-anchor": "end", class: "pw-axis" }, gridLines).textContent = hp;
}
for (let rpm = 2000; rpm <= CHART.rpmMax; rpm += 1000) {
  svg("line", { x1: chartX(rpm), x2: chartX(rpm), y1: CHART.top, y2: CHART.bottom, class: "pw-grid" }, gridLines);
  if (rpm < CHART.rpmMax) svg("text", { x: chartX(rpm), y: CHART.bottom + 26, "text-anchor": "middle", class: "pw-axis" }, gridLines).textContent = formatNumber.format(rpm);
}
svg("text", { x: CHART.left - 12, y: CHART.top - 12, "text-anchor": "end", class: "pw-axis" }, gridLines).textContent = "HP";
svg("text", { x: CHART.right, y: CHART.bottom + 26, "text-anchor": "end", class: "pw-axis" }, gridLines).textContent = "RPM";
const curve = (values) => POWER.rpm.map((rpm, i) => [chartX(rpm), chartY(values[i])]);
const tunedPoints = curve(POWER.tuned);
const tunedPath = smoothPath(tunedPoints);
$(".pw-stock").setAttribute("d", smoothPath(curve(POWER.stock)));
$(".pw-tuned").setAttribute("d", tunedPath);
const lastPoint = tunedPoints[tunedPoints.length - 1];
$(".pw-area").setAttribute("d", `${tunedPath}L${lastPoint[0].toFixed(1)} ${CHART.bottom}L${tunedPoints[0][0].toFixed(1)} ${CHART.bottom}Z`);
const peaks = $(".pw-peaks");
[["stock", STOCK_HP, 30], ["tuned", TUNED_HP, -22]].forEach(([kind, hp, dy]) => {
  const group = svg("g", { class: `pw-peak pw-peak--${kind}` }, peaks);
  svg("circle", { cx: chartX(5500), cy: chartY(hp), r: 6, class: "pw-dot" }, group);
  svg("text", { x: chartX(5500), y: chartY(hp) + dy, class: "pw-label" }, group).textContent = `${hp} HP`;
});

// ---------- Business details and photos from the admin panel ----------
const whatsappUrl = (text) => `https://wa.me/${business.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
const mapUrl = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const instagramHandle = (url) => {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean)[0];
    return name ? `@${name}` : "Instagram";
  } catch {
    return "Instagram";
  }
};

function buildCard({ image, caption, link }) {
  const [title, tag, ...rest] = String(caption || "").split(" · ");
  const figure = document.createElement(link ? "a" : "figure");
  figure.className = "build";
  if (link) Object.assign(figure, { href: link, target: "_blank", rel: "noopener" });
  const frame = document.createElement("div");
  frame.className = "build__frame";
  frame.append(Object.assign(document.createElement("img"), { src: image, alt: caption || "Customer car", decoding: "async" }));
  const text = document.createElement(link ? "div" : "figcaption");
  text.className = "build__caption";
  if (tag) text.append(Object.assign(document.createElement("span"), { className: "build__tag", textContent: tag }));
  text.append(Object.assign(document.createElement("b"), { textContent: title || "Customer build" }));
  if (rest.length) text.append(Object.assign(document.createElement("small"), { textContent: rest.join(" · ") }));
  figure.append(frame, text);
  return figure;
}

async function syncWithSite() {
  if (!LIVE) return;
  let data;
  try {
    const response = await fetch("/api/site", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    data = await response.json();
  } catch {
    return;
  }
  const s = data.settings ?? {};
  if (s.whatsappNumber) business.whatsapp = String(s.whatsappNumber).replace(/\D/g, "") || business.whatsapp;
  $$("[data-whatsapp-link]").forEach((link) => { link.href = whatsappUrl(link.dataset.whatsappText); });
  if (s.phone) $$("[data-phone]").forEach((el) => { el.textContent = s.phone; });
  if (s.hours) $$("[data-hours]").forEach((el) => { el.textContent = s.hours; });
  if (s.address) {
    $$("[data-address]").forEach((el) => { el.textContent = s.address; });
    $$("[data-map-link]").forEach((link) => { link.href = Number.isFinite(s.latitude) && Number.isFinite(s.longitude) ? `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}` : mapUrl(s.address); });
  }
  if (s.instagram) {
    $$("[data-instagram-link]").forEach((link) => { link.href = s.instagram; });
    $$("[data-instagram-handle]").forEach((el) => { el.textContent = instagramHandle(s.instagram); });
  }
  // New photos added in the admin panel replace the four built-in builds.
  const photos = (data.photos ?? []).filter((photo) => photo.image);
  const track = $(".builds__track");
  const builtIn = $$("[data-photo-id]", track).map((el) => el.dataset.photoId);
  if (photos.length && photos.map((photo) => photo.id).join() !== builtIn.join()) {
    const cta = $(".build--cta", track);
    $$(".build:not(.build--cta)", track).forEach((el) => el.remove());
    photos.slice(0, 12).forEach((photo) => track.insertBefore(buildCard(photo), cta));
    if (hasGsap) {
      const images = $$("img", track);
      Promise.all(images.map((img) => (img.complete ? null : new Promise((done) => img.addEventListener("load", done, { once: true }))))).then(() => ScrollTrigger.refresh());
    }
  }
}
syncWithSite();

// ---------- Booking form ----------
const form = $(".form");
const status = $(".form__status");
const rules = {
  name: (value) => (value.length >= 2 ? "" : "Please enter your name."),
  phone: (value) => {
    const digits = value.replace(/\D/g, "");
    return /^\+?[\d\s().-]+$/.test(value) && digits.length >= 10 && digits.length <= 13 ? "" : "Please enter a valid mobile number.";
  },
  car: (value) => (value.length >= 2 ? "" : "Tell us the make and model."),
  service: (value) => (value ? "" : "Choose the service you want.")
};
function checkField(name) {
  const input = form.elements[name];
  const message = rules[name](input.value.trim());
  const field = input.closest(".field");
  field.classList.toggle("has-error", Boolean(message));
  $(".field__error", field).textContent = message;
  if (message) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${input.id}-error`);
  } else {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
  return !message;
}
// Errors only appear on submit and clear while typing, so nothing shifts under the pointer
// between pressing and releasing the submit button.
Object.keys(rules).forEach((name) => {
  const input = form.elements[name];
  input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
    if (input.closest(".field").classList.contains("has-error")) checkField(name);
  });
});

function showStatus(text, url, linkText) {
  status.replaceChildren(text);
  if (url) status.append(" ", Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener", textContent: linkText }));
}

// On the site the booking is saved first (it appears in the admin panel and alerts the workshop on
// Telegram); either way WhatsApp then opens with the details. Only a mistake in the form stops it.
async function saveBooking(details) {
  if (!LIVE) return null;
  try {
    const response = await fetch("/api/enquiries", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ name: details.name, phone: details.phone, message: `Booking from the home page. Car: ${details.car}. Service: ${details.service}.` })
    });
    if (response.status !== 400) return { saved: response.ok };
    const body = await response.json().catch(() => ({}));
    return { error: body.error || "Please check your details and try again." };
  } catch {
    return null;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const names = Object.keys(rules);
  const results = names.map(checkField);
  if (results.includes(false)) {
    form.elements[names[results.indexOf(false)]].focus();
    status.textContent = "";
    return;
  }
  const value = (name) => form.elements[name].value.trim();
  const details = { name: value("name"), phone: value("phone"), car: value("car"), service: value("service") };
  const button = $("button[type=submit]", form);
  button.disabled = true;
  showStatus("Sending your booking…");
  const saved = await saveBooking(details);
  button.disabled = false;
  if (saved?.error) {
    showStatus(saved.error);
    return;
  }
  const url = whatsappUrl([
    "Hi Unity Performance, I'd like to book a tune.",
    `Name: ${details.name}`,
    `Phone: ${details.phone}`,
    `Car: ${details.car}`,
    `Service: ${details.service}`
  ].join("\n"));
  showStatus(saved?.saved ? `Thanks, ${details.name}. We've got your booking.` : "Your booking message is ready.", url, "Open WhatsApp to send it to us");
  window.open(url, "_blank", "noopener");
});

// ---------- Scroll animations ----------
function setupAnimations() {
  gsap.to(progress, { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });

  gsap.from(".hero__title .line > span", { yPercent: 110, duration: 1.1, ease: "power4.out", stagger: 0.09, delay: 0.1 });
  gsap.from([".hero .eyebrow", ".hero__lead", ".hero__actions", ".hud"], { y: 26, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, delay: 0.45 });
  gsap.to(".hero__content", { yPercent: -16, opacity: 0.2, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });

  // The fire band speeds up while the page moves; headings and cards lean into the scroll.
  const loop = gsap.to(".band__track", { xPercent: -50, ease: "none", duration: 24, repeat: -1 });
  const lean = gsap.quickTo([".section-head h2", ".svc", ".review", ".build"], "skewY", { duration: 0.5, ease: "power3" });
  ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate(self) {
      const velocity = self.getVelocity();
      const boost = 1 + Math.min(Math.abs(velocity) / 260, 5);
      gsap.to(loop, { timeScale: boost, duration: 0.2, overwrite: true, onComplete: () => gsap.to(loop, { timeScale: 1, duration: 1.4 }) });
      lean(clamp(velocity / -500, -5, 5));
    }
  });
  ScrollTrigger.addEventListener("scrollEnd", () => lean(0));

  $$(".section-head, .rev__head, .power__copy, .booking__copy").forEach((head) => {
    gsap.from(head.children, { y: 50, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.1, scrollTrigger: { trigger: head, start: "top 85%", once: true } });
  });

  $$(".stat").forEach((stat, index) => {
    const valueEl = $(".stat__value", stat);
    const target = Number(valueEl.dataset.count);
    const counter = { value: 0 };
    valueEl.textContent = "0";
    gsap.from($(".stat__bar", stat), { scaleX: 0, duration: 1.2, ease: "power3.out", delay: index * 0.12, scrollTrigger: { trigger: stat, start: "top 88%", once: true } });
    gsap.to(counter, {
      value: target,
      duration: 2.2,
      delay: index * 0.12,
      ease: "power3.out",
      onUpdate: () => { valueEl.textContent = formatNumber.format(Math.round(counter.value)); },
      scrollTrigger: { trigger: stat, start: "top 88%", once: true }
    });
  });

  // Rev counter: pinned while the needle sweeps to the limiter.
  const engine = { rpm: 850 };
  gsap.timeline({ scrollTrigger: { trigger: ".rev", start: "top top", end: "+=160%", scrub: 0.6, pin: true, anticipatePin: 1 } })
    .to(engine, { rpm: 7600, ease: "power1.in", duration: 1, onUpdate: () => setRpm(engine.rpm) })
    .to({}, { duration: 0.2 });

  gsap.set(".svc", { opacity: 0, x: 110, skewX: -4 });
  ScrollTrigger.batch(".svc", {
    start: "top 90%",
    once: true,
    onEnter: (cards) => gsap.to(cards, { opacity: 1, x: 0, skewX: 0, duration: 1, ease: "power4.out", stagger: 0.16, overwrite: "auto" })
  });

  const stockLine = $(".pw-stock");
  const tunedLine = $(".pw-tuned");
  [stockLine, tunedLine].forEach((line) => {
    const length = line.getTotalLength();
    gsap.set(line, { strokeDasharray: `${length} ${length}`, strokeDashoffset: length });
  });
  gsap.set(".pw-area", { opacity: 0 });
  gsap.set(".pw-peak", { opacity: 0, scale: 0.6, transformOrigin: "50% 50%" });
  gsap.timeline({ scrollTrigger: { trigger: ".chart", start: "top 80%", end: "bottom 50%", scrub: 0.8 } })
    .to(stockLine, { strokeDashoffset: 0, ease: "none", duration: 1 })
    .to(tunedLine, { strokeDashoffset: 0, ease: "none", duration: 1.2 }, 0.35)
    .to(".pw-area", { opacity: 1, duration: 0.4 }, 1.5)
    .to(".pw-peak", { opacity: 1, scale: 1, duration: 0.3, stagger: 0.12 }, 1.55);
  gsap.from(".figure", { y: 30, opacity: 0, duration: 0.8, ease: "power3.out", stagger: 0.1, scrollTrigger: { trigger: ".figures", start: "top 88%", once: true } });

  const media = gsap.matchMedia();
  media.add("(min-width: 1024px)", () => {
    const section = $(".builds");
    const rail = $(".builds__rail");
    section.classList.add("is-horizontal");
    const distance = () => Math.max(0, rail.scrollWidth - window.innerWidth);
    const ride = gsap.to(rail, {
      x: () => -distance(),
      ease: "none",
      scrollTrigger: { trigger: section, start: "top top", end: () => `+=${distance()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true }
    });
    $$(".build img").forEach((img) => {
      gsap.fromTo(img, { xPercent: 5 }, {
        xPercent: -5,
        ease: "none",
        scrollTrigger: { trigger: img.closest(".build"), containerAnimation: ride, start: "left right", end: "right left", scrub: true }
      });
    });
    return () => section.classList.remove("is-horizontal");
  });
  media.add("(max-width: 1023px)", () => {
    gsap.from(".build", { x: 80, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.1, scrollTrigger: { trigger: ".builds__track", start: "top 85%", once: true } });
  });

  gsap.from(".review", { y: 60, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.14, scrollTrigger: { trigger: ".reviews__grid", start: "top 85%", once: true } });
  gsap.from(".form", { y: 60, opacity: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: ".form", start: "top 88%", once: true } });
  gsap.from(".footer__mega", { yPercent: 40, opacity: 0, duration: 1.2, ease: "power3.out", scrollTrigger: { trigger: ".footer", start: "top 90%", once: true } });

  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  window.addEventListener("load", () => ScrollTrigger.refresh());
}
if (animate) setupAnimations();

// ---------- The drifting car (a placeholder model built from simple shapes) ----------
// Glossy reflections come from a small "studio" of glowing panels, including a fire-coloured one.
function studioEnvironment(THREE) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x0a0a0b, side: THREE.BackSide }));
  room.position.y = 4;
  scene.add(room);
  const panel = (w, h, position, rotation, color, strength) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide }));
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    scene.add(mesh);
  };
  panel(10, 3, [0, 8.9, 0], [Math.PI / 2, 0, 0], 0xffffff, 3);
  panel(7, 2.5, [-9.9, 3, 0], [0, Math.PI / 2, 0], 0xff5a14, 2.6);
  panel(6, 2.5, [9.9, 3, -2], [0, -Math.PI / 2, 0], 0xffffff, 1.3);
  panel(9, 1.6, [0, 2.2, -9.9], [0, 0, 0], 0xff3a10, 2.2);
  return scene;
}

// ExtrudeGeometry has a separate vertex per face; sharing vertices lets the normals blend smoothly.
function shareVertices(THREE, geometry) {
  const position = geometry.attributes.position;
  const ids = new Map();
  const unique = [];
  const index = [];
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = unique.length / 3;
      ids.set(key, id);
      unique.push(x, y, z);
    }
    index.push(id);
  }
  const shared = new THREE.BufferGeometry();
  shared.setAttribute("position", new THREE.Float32BufferAttribute(unique, 3));
  shared.setIndex(index);
  return shared;
}

function buildCar(THREE) {
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xa80c06, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x060709, metalness: 0.15, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.55 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0.3, roughness: 0.55 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.92 });
  const alloy = new THREE.MeshStandardMaterial({ color: 0x3d4045, metalness: 0.95, roughness: 0.22 });
  const disc = new THREE.MeshStandardMaterial({ color: 0x6f7176, metalness: 0.9, roughness: 0.45 });
  const caliper = new THREE.MeshStandardMaterial({ color: 0xff8a12, metalness: 0.2, roughness: 0.4 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd4d6da, metalness: 1, roughness: 0.16, side: THREE.DoubleSide });
  const soot = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const headlight = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const taillight = new THREE.MeshBasicMaterial({ color: 0xff1a10, toneMapped: false });

  // Extrude a side profile, then pull the sides in towards the roof and the ends so it reads as a car.
  const extrude = (shape, depth, bevel, taper) => {
    const raw = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 8, curveSegments: 40 });
    raw.translate(0, 0, -depth / 2);
    const geo = shareVertices(THREE, raw);
    raw.dispose();
    const position = geo.attributes.position;
    for (let i = 0; i < position.count; i += 1) position.setZ(i, position.getZ(i) * taper(position.getX(i), position.getY(i)));
    geo.computeVertexNormals();
    return geo;
  };

  const body = new THREE.Shape();
  body.moveTo(2.18, 0.28);
  body.lineTo(2.3, 0.42);
  body.quadraticCurveTo(2.38, 0.6, 2.22, 0.72);
  body.quadraticCurveTo(1.6, 0.84, 0.95, 0.9);
  body.lineTo(-1.3, 0.9);
  body.quadraticCurveTo(-1.95, 0.92, -2.16, 0.97);
  body.lineTo(-2.24, 0.93);
  body.quadraticCurveTo(-2.32, 0.64, -2.22, 0.34);
  body.lineTo(-2.05, 0.28);
  body.lineTo(-1.88, 0.28);
  body.absarc(-1.4, 0.33, 0.46, Math.PI, 0, true);
  body.lineTo(-0.94, 0.28);
  body.lineTo(0.94, 0.28);
  body.absarc(1.4, 0.33, 0.46, Math.PI, 0, true);
  body.lineTo(1.95, 0.28);
  body.lineTo(2.18, 0.28);
  const bodyTaper = (x, y) => (1 - Math.max(0, y - 0.55) * 0.35) * (1 - Math.max(0, Math.abs(x) - 1.7) * 0.32);
  car.add(new THREE.Mesh(extrude(body, 1.72, 0.14, bodyTaper), paint));

  const cabin = new THREE.Shape();
  cabin.moveTo(1.1, 0.82);
  cabin.quadraticCurveTo(0.55, 1.08, 0.05, 1.3);
  cabin.quadraticCurveTo(-0.45, 1.38, -0.95, 1.3);
  cabin.quadraticCurveTo(-1.55, 1.12, -1.95, 0.9);
  cabin.lineTo(-1.8, 0.82);
  cabin.lineTo(1.1, 0.82);
  car.add(new THREE.Mesh(extrude(cabin, 1.5, 0.1, (x, y) => 1 - Math.max(0, y - 0.85) * 0.55), glass));

  const box = (w, h, d, material, x, y, z, parent = car) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  box(1.68, 0.08, 0.08, trim, 0, 0.31, 0.97);
  box(1.68, 0.08, 0.08, trim, 0, 0.31, -0.97);
  box(0.36, 0.04, 1.6, trim, 2.16, 0.29, 0);
  box(0.34, 0.1, 1.4, trim, -2.1, 0.31, 0);
  box(0.06, 0.13, 1.0, trim, 2.33, 0.49, 0);
  box(0.16, 0.08, 0.12, paint, 0.78, 0.97, 0.9);
  box(0.16, 0.08, 0.12, paint, 0.78, 0.97, -0.9);
  box(0.06, 0.045, 0.4, headlight, 2.3, 0.66, 0.46).rotation.z = -0.35;
  box(0.06, 0.045, 0.4, headlight, 2.3, 0.66, -0.46).rotation.z = -0.35;
  box(0.04, 0.05, 1.3, taillight, -2.32, 0.86, 0);

  const exhausts = [];
  [0.45, -0.45].forEach((z) => {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.22, 24, 1, true), chrome);
    tip.rotation.z = Math.PI / 2;
    tip.position.set(-2.33, 0.38, z);
    const inside = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), soot);
    inside.rotation.y = -Math.PI / 2;
    inside.position.set(-2.3, 0.38, z);
    car.add(tip, inside);
    exhausts.push(new THREE.Vector3(-2.46, 0.38, z));
  });

  const front = [];
  const rearSpin = [];
  const frontSpin = [];
  const wheel = (x, side) => {
    const steer = new THREE.Group();
    steer.position.set(x, 0.33, side * 0.82);
    const flip = new THREE.Group();
    if (side < 0) flip.rotation.y = Math.PI;
    const spin = new THREE.Group();
    steer.add(flip);
    flip.add(spin);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.26, 48), rubber);
    tire.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.27, 40), alloy);
    rim.rotation.x = Math.PI / 2;
    spin.add(tire, rim);
    for (let i = 0; i < 5; i += 1) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.03), alloy);
      const angle = (i / 5) * Math.PI * 2;
      spoke.position.set(Math.sin(angle) * 0.11, Math.cos(angle) * 0.11, 0.14);
      spoke.rotation.z = -angle;
      spin.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 20), alloy);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.145;
    spin.add(hub);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 32), disc);
    brake.rotation.x = Math.PI / 2;
    brake.position.z = 0.1;
    flip.add(brake);
    box(0.09, 0.15, 0.06, caliper, -0.12, 0.09, 0.1, flip).rotation.z = 0.6;
    car.add(steer);
    (x > 0 ? frontSpin : rearSpin).push(spin);
    if (x > 0) front.push(steer);
  };
  [1.4, -1.4].forEach((x) => { wheel(x, 1); wheel(x, -1); });

  car.traverse((child) => {
    if (child.isMesh && child.material !== headlight && child.material !== taillight && child.material !== soot) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  const rearContacts = [new THREE.Vector3(-1.4, 0.05, 0.95), new THREE.Vector3(-1.4, 0.05, -0.95)];
  return { car, front, frontSpin, rearSpin, exhausts, rearContacts };
}

function canvasTexture(THREE, size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d"), size);
  return new THREE.CanvasTexture(canvas);
}

// Soft round sprites drawn as one batch of points: tyre smoke (normal blending) and flames (additive).
function particleSystem(THREE, { count, map, additive }) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const age = new Float32Array(count).fill(1);
  const life = new Float32Array(count).fill(1);
  const from = new Float32Array(count);
  const to = new Float32Array(count);
  const shade = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  const attribute = (array, size) => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute(positions, 3));
  geometry.setAttribute("size", attribute(sizes, 1));
  geometry.setAttribute("alpha", attribute(alphas, 1));
  geometry.setAttribute("tint", attribute(tints, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, scale: { value: 800 } },
    vertexShader: `
      attribute float size;
      attribute float alpha;
      attribute vec3 tint;
      uniform float scale;
      varying float vAlpha;
      varying vec3 vTint;
      void main() {
        vAlpha = alpha;
        vTint = tint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying float vAlpha;
      varying vec3 vTint;
      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        float a = tex.a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vTint * tex.rgb, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  let next = 0;
  return {
    points,
    material,
    spawn(p, v, seconds, startSize, endSize) {
      const i = next;
      next = (next + 1) % count;
      positions.set([p.x, p.y, p.z], i * 3);
      velocity.set([v.x, v.y, v.z], i * 3);
      age[i] = 0;
      life[i] = seconds;
      from[i] = startSize;
      to[i] = endSize;
      shade[i] = Math.random();
    },
    // look(t, shade) returns [size factor 0..1, alpha, r, g, b] for a particle t of the way through its life.
    update(dt, { drag, lift, look }) {
      const keep = Math.exp(-drag * dt);
      for (let i = 0; i < count; i += 1) {
        if (age[i] >= life[i]) {
          alphas[i] = 0;
          sizes[i] = 0;
          continue;
        }
        age[i] += dt;
        const t = Math.min(1, age[i] / life[i]);
        const j = i * 3;
        velocity[j] *= keep;
        velocity[j + 1] = velocity[j + 1] * keep + lift * dt;
        velocity[j + 2] *= keep;
        positions[j] += velocity[j] * dt;
        positions[j + 1] += velocity[j + 1] * dt;
        positions[j + 2] += velocity[j + 2] * dt;
        const [grow, alpha, r, g, b] = look(t, shade[i]);
        sizes[i] = from[i] + (to[i] - from[i]) * grow;
        alphas[i] = alpha;
        tints[j] = r;
        tints[j + 1] = g;
        tints[j + 2] = b;
      }
      for (const name of ["position", "size", "alpha", "tint"]) geometry.attributes[name].needsUpdate = true;
    }
  };
}

const smokeLook = (t, shade) => {
  const fade = t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 1.4);
  const grey = 0.5 + shade * 0.2;
  return [1 - Math.pow(1 - t, 2), fade * 0.42, grey + 0.05, grey, grey - 0.02];
};
const flameLook = (t) => {
  const alpha = Math.pow(1 - t, 1.3);
  if (t < 0.3) {
    const k = t / 0.3;
    return [t, alpha, 1, 0.95 - 0.4 * k, 0.75 - 0.63 * k];
  }
  const k = (t - 0.3) / 0.7;
  return [t, alpha, 1 - 0.25 * k, 0.55 - 0.45 * k, 0.12 - 0.09 * k];
};

// A curtain of flame standing behind the car: layered noise scrolling upwards, hottest at the floor.
function fireCurtain(THREE) {
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, heat: { value: 1 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float time;
      uniform float heat;
      varying vec2 vUv;
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p = p * 2.03 + vec2(1.7, 9.2);
          a *= 0.5;
        }
        return v;
      }
      void main() {
        vec2 uv = vUv;
        float reach = 0.55 + 0.4 * heat;
        vec2 r = vec2(uv.x * 18.0, uv.y * 2.2 - time * 2.6);
        float n = fbm(vec2(r.x + fbm(r * 0.5 - vec2(0.0, time)) * 1.5, r.y));
        float tongues = 0.55 + 0.45 * sin(uv.x * 62.0 + fbm(vec2(uv.x * 13.0, time * 0.6)) * 6.0);
        float edge = smoothstep(0.0, 0.2, uv.x) * smoothstep(1.0, 0.8, uv.x) * smoothstep(0.02, 0.2, uv.y);
        float body = n * (0.8 + 0.5 * tongues) - uv.y / reach;
        float flame = smoothstep(0.02, 0.32, body) * edge;
        float core = smoothstep(0.28, 0.6, body) * (1.0 - uv.y * 0.9);
        vec3 color = mix(vec3(0.6, 0.05, 0.0), vec3(1.0, 0.38, 0.05), smoothstep(0.1, 0.7, flame));
        color = mix(color, vec3(1.0, 0.85, 0.45), core);
        gl_FragColor = vec4(color, flame * 0.85);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.4), material);
  // Drawn after the see-through floor, which would otherwise paint over the base of the flames.
  mesh.renderOrder = 1;
  return mesh;
}

async function initHero() {
  const hero = $(".hero");
  const canvas = $(".hero__canvas");
  const url = $('meta[name="three-module"]')?.content;
  if (!canvas || !url) return;
  let THREE;
  try {
    THREE = await import(url);
  } catch {
    return; // the drawn silhouette stays in place
  }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, alpha: true, powerPreference: "high-performance" });
  } catch {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioEnvironment(THREE), 0.04).texture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();

  // The car spins around a point between its front wheels and the driver: a donut.
  const rig = new THREE.Group();
  rig.rotation.y = 2.2;
  scene.add(rig);
  const model = buildCar(THREE);
  model.car.position.x = -0.9;
  rig.add(model.car);
  model.front.forEach((steer) => { steer.rotation.y = 0.55; });

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(10, 72),
    new THREE.MeshStandardMaterial({
      color: 0x101011,
      roughness: 0.7,
      metalness: 0.25,
      transparent: true,
      alphaMap: canvasTexture(THREE, 256, (ctx, size) => {
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, "#fff");
        gradient.addColorStop(0.45, "#bbb");
        gradient.addColorStop(1, "#000");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
      })
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Rubber laid down by the rear tyres (and the front ones turning on the spot).
  const span = 9;
  const marks = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span),
    new THREE.MeshBasicMaterial({
      color: 0x030303,
      transparent: true,
      depthWrite: false,
      alphaMap: canvasTexture(THREE, 1024, (ctx, size) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size, size);
        const px = size / span;
        const ring = (radius, width, count, strength) => {
          for (let i = 0; i < count; i += 1) {
            const g = Math.round(255 * strength * (0.25 + Math.random() * 0.75));
            ctx.strokeStyle = `rgb(${g},${g},${g})`;
            ctx.lineWidth = 1 + Math.random() * 3;
            ctx.beginPath();
            const start = Math.random() * Math.PI * 2;
            ctx.arc(size / 2, size / 2, (radius + (Math.random() - 0.5) * width) * px, start, start + Math.PI * (1.2 + Math.random() * 0.8));
            ctx.stroke();
          }
        };
        ring(Math.hypot(2.3, 0.82), 0.34, 90, 0.75);
        ring(Math.hypot(0.5, 0.82), 0.22, 30, 0.45);
      })
    })
  );
  marks.rotation.x = -Math.PI / 2;
  marks.position.y = 0.003;
  scene.add(marks);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x0b0b0c, 0.3));
  const key = new THREE.SpotLight(0xffffff, 170, 0, 0.6, 0.7, 2);
  key.position.set(1.2, 8, 2.4);
  key.target.position.set(0, 0.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 15;
  scene.add(key, key.target);
  const rimRed = new THREE.SpotLight(0xff2a1f, 220, 0, 0.5, 0.85, 2);
  rimRed.position.set(-5.5, 2.6, -3.6);
  rimRed.target.position.set(0, 0.9, 0);
  scene.add(rimRed, rimRed.target);
  const rimCool = new THREE.SpotLight(0xc4d6ff, 120, 0, 0.5, 0.85, 2);
  rimCool.position.set(5.5, 3, -4.6);
  rimCool.target.position.set(0, 0.9, 0);
  scene.add(rimCool, rimCool.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45);
  fill.position.set(3, 2, 7);
  scene.add(fill);
  // Firelight from the wall of flames behind the car, and the flash of each backfire.
  const fireLight = new THREE.PointLight(0xff5a14, 30, 0, 2);
  fireLight.position.set(-2.4, 1.2, -3.4);
  scene.add(fireLight);
  const exhaustLight = new THREE.PointLight(0xff7a1a, 0, 0, 2);
  scene.add(exhaustLight);

  const smokeMap = canvasTexture(THREE, 128, (ctx, size) => {
    for (let i = 0; i < 22; i += 1) {
      const radius = size * (0.12 + Math.random() * 0.2);
      const x = size / 2 + (Math.random() - 0.5) * size * 0.36;
      const y = size / 2 + (Math.random() - 0.5) * size * 0.36;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,0.32)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
  });
  const flameMap = canvasTexture(THREE, 64, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.65)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
  const curtain = fireCurtain(THREE);
  // Its foot sits just under the floor, so the flames grow out of the ground.
  curtain.position.set(-3.3, 1.4, -4.6);
  curtain.rotation.y = 0.62;
  scene.add(curtain);

  const smoke = particleSystem(THREE, { count: phone ? 170 : 340, map: smokeMap, additive: false });
  const flames = particleSystem(THREE, { count: phone ? 180 : 320, map: flameMap, additive: true });
  scene.add(smoke.points, flames.points);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const lookAt = new THREE.Vector3(-0.3, 0.55, 0);
  let distance = 14;
  function resize() {
    const width = hero.clientWidth;
    const height = hero.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const side = width >= 900 && camera.aspect > 1.15;
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    distance = Math.max(side ? 17 : 11, 3.5 / (halfFov * camera.aspect));
    if (side) camera.setViewOffset(width, height, -width * 0.16, height * 0.12, width, height);
    else camera.setViewOffset(width, height, 0, height * 0.22, width, height);
    camera.updateProjectionMatrix();
    const scale = (renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2) / halfFov;
    smoke.material.uniforms.scale.value = scale;
    flames.material.uniforms.scale.value = scale;
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (matchMedia("(pointer: fine)").matches && !reduceMotion) {
    window.addEventListener("pointermove", (event) => {
      pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }
  function place(scroll) {
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const azimuth = 0.62 + pointer.x * 0.12;
    const elevation = 0.2 + scroll * 0.12 - pointer.y * 0.04;
    const dist = distance * (1 - scroll * 0.14);
    camera.position.set(
      lookAt.x + Math.sin(azimuth) * Math.cos(elevation) * dist,
      lookAt.y + Math.sin(elevation) * dist,
      lookAt.z + Math.cos(azimuth) * Math.cos(elevation) * dist
    );
    camera.lookAt(lookAt);
  }

  const world = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const velocity = new THREE.Vector3();
  const lastExhaust = model.exhausts.map(() => new THREE.Vector3());
  const lastContact = model.rearContacts.map(() => new THREE.Vector3());
  const projected = new THREE.Vector3();
  let smokeDue = 0;
  let flameDue = 0;
  let nextBackfire = 1.8;
  let clock = 0;
  let flash = 0;
  const rand = (spread) => (Math.random() - 0.5) * spread;

  function backfire() {
    model.car.getWorldQuaternion(quaternion);
    direction.set(-1, 0, 0).applyQuaternion(quaternion);
    model.exhausts.forEach((tip) => {
      world.copy(tip);
      model.car.localToWorld(world);
      for (let i = 0; i < 26; i += 1) {
        const speed = 3.5 + Math.random() * 3;
        flames.spawn(world, { x: direction.x * speed + rand(1.8), y: direction.y * speed + rand(1.2) + 0.4, z: direction.z * speed + rand(1.8) }, 0.22 + Math.random() * 0.22, 0.4 + Math.random() * 0.2, 0.8 + Math.random() * 0.4);
      }
    });
    flash = 1;
    projected.copy(world).project(camera);
    const box = canvas.getBoundingClientRect();
    const x = box.left + ((projected.x + 1) / 2) * box.width;
    const y = box.top + ((1 - projected.y) / 2) * box.height;
    hero.style.setProperty("--flash-x", `${((x - box.left) / box.width) * 100}%`);
    hero.style.setProperty("--flash-y", `${((y - box.top) / box.height) * 100}%`);
    fx.burst(x, y, 10);
  }

  function simulate(dt) {
    clock += dt;
    const level = burnout.level;
    const scroll = clamp(window.scrollY / Math.max(1, hero.offsetHeight), 0, 1);
    rig.rotation.y += dt * (0.9 + level * 0.6 + scroll * 1.6);
    model.car.rotation.x = 0.035 * level;
    model.car.rotation.z = 0.015 * level;
    model.rearSpin.forEach((spin) => { spin.rotation.z -= dt * (8 + 34 * level); });
    model.frontSpin.forEach((spin) => { spin.rotation.z -= dt * 3; });
    rig.updateMatrixWorld(true);

    // Tyre smoke pours off the rear wheels and keeps a little of their sideways speed.
    smokeDue += dt * (10 + 34 * level) * model.rearContacts.length;
    model.rearContacts.forEach((contact, i) => {
      world.copy(contact);
      model.car.localToWorld(world);
      velocity.copy(world).sub(lastContact[i]).divideScalar(Math.max(dt, 0.001));
      lastContact[i].copy(world);
    });
    while (smokeDue >= 1) {
      smokeDue -= 1;
      const i = (Math.random() * model.rearContacts.length) | 0;
      world.copy(model.rearContacts[i]);
      model.car.localToWorld(world);
      world.x += rand(0.3);
      world.z += rand(0.3);
      smoke.spawn(world, { x: velocity.x * 0.22 + rand(0.8), y: 0.35 + Math.random() * 0.5, z: velocity.z * 0.22 + rand(0.8) }, 2.2 + Math.random() * 1.2, 0.5, 2.6 + Math.random() * 1.2);
    }

    // Exhaust: a flutter of flame, and every so often a bang.
    model.car.getWorldQuaternion(quaternion);
    direction.set(-1, 0, 0).applyQuaternion(quaternion);
    flameDue += dt * 26 * level * (0.4 + Math.random() * 0.6) * model.exhausts.length;
    model.exhausts.forEach((tip, i) => {
      world.copy(tip);
      model.car.localToWorld(world);
      lastExhaust[i].copy(world);
    });
    while (flameDue >= 1) {
      flameDue -= 1;
      const tip = lastExhaust[(Math.random() * lastExhaust.length) | 0];
      const speed = 2.2 + Math.random() * 1.6;
      flames.spawn(tip, { x: direction.x * speed + rand(0.5), y: rand(0.4) + 0.2, z: direction.z * speed + rand(0.5) }, 0.1 + Math.random() * 0.12, 0.22 + Math.random() * 0.1, 0.42);
    }
    nextBackfire -= dt;
    if (nextBackfire <= 0 && level > 0.35) {
      nextBackfire = 1.3 + Math.random() * 1.9;
      backfire();
    }
    flash *= Math.exp(-dt * 11);
    exhaustLight.position.copy(lastExhaust[0]).add(lastExhaust[1]).multiplyScalar(0.5);
    exhaustLight.intensity = level * (2 + Math.random() * 2) + flash * 70;
    fireLight.intensity = 26 + Math.sin(clock * 11) * 4 + Math.random() * 6 + flash * 10;
    hero.style.setProperty("--flash", (flash * 0.9).toFixed(3));
    curtain.material.uniforms.time.value = clock;
    curtain.material.uniforms.heat.value = 0.75 + 0.15 * Math.sin(clock * 2.3) + flash * 0.35;

    smoke.update(dt, { drag: 1.1, lift: 0.18, look: smokeLook });
    flames.update(dt, { drag: 3.2, lift: 1.2, look: flameLook });
    place(scroll);
  }

  resize();
  window.addEventListener("resize", resize);
  model.rearContacts.forEach((contact, i) => lastContact[i].copy(contact).applyMatrix4(model.car.matrixWorld));
  if (reduceMotion) {
    // A still frame mid-drift, smoke and all.
    for (let i = 0; i < 90; i += 1) simulate(1 / 30);
    renderer.render(scene, camera);
    window.addEventListener("resize", () => renderer.render(scene, camera));
  } else {
    simulate(1 / 60);
    renderer.render(scene, camera);
    whileVisible(hero, (dt) => {
      simulate(dt);
      renderer.render(scene, camera);
    });
  }
  hero.classList.add("is-3d");
  heroFire = null;
}
initHero();
