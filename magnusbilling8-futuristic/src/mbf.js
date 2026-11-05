/*!
 * MagnusBilling 8 — Futuristic Theme (MBF) runtime
 *
 * Loaded from index.html (right after resources/init.css) by mbf-install.sh.
 * Responsibilities:
 *   1. Load mbf.css before ExtJS boots and tag <html> with the theme classes.
 *   2. Draw the animated "signal network" background (pauses when hidden).
 *   3. Decorate the login screen with a live status HUD.
 *   4. Standard layout extras: live HUD bar (active calls + sparkline,
 *      latency, clock), Ctrl/Cmd+K command palette to jump to any module
 *      (SIP Users, Caller ID, Rates...), and the Theme Studio.
 *
 * Nothing here changes MagnusBilling data or server behaviour. The only
 * server request is a read of index.php/callOnLine/read (the same endpoint
 * the "Calls Online" module uses) for admins, while the tab is visible and
 * the user is active.
 *
 * Escape hatch: open the panel with ?mbf=off to load the stock look once.
 * License: GPL-3.0-or-later.
 */
(function (window, document) {
    'use strict';

    if (window.MBF && window.MBF.version) {
        return;
    }

    var VERSION = '1.0.0';
    var LS_SETTINGS = 'mbf.settings.v1';
    var LS_RECENT = 'mbf.recent.v1';
    var root = document.documentElement;

    /* ------------------------------------------------------------------ */
    /* Paths                                                               */
    /* ------------------------------------------------------------------ */
    var scriptEl = document.currentScript;
    var scriptSrc = (scriptEl && scriptEl.src) || '';
    var BASE = scriptSrc ? scriptSrc.replace(/[?#].*$/, '').replace(/[^\/]*$/, '') : 'resources/futuristic/';
    var QS = (scriptSrc.match(/\?[^#]*/) || ['?v=' + VERSION])[0];

    /* ------------------------------------------------------------------ */
    /* Settings: defaults < server (mbf-config.js) < this browser          */
    /* ------------------------------------------------------------------ */
    var DEFAULTS = {
        enabled: true,
        accent: 'cyan',          // cyan | magenta | matrix | amber | violet | ice
        background: 'network',   // network | grid | static | off
        glass: true,
        motion: true,
        googleFonts: true,
        hud: true,
        hudPollSeconds: 10,
        palette: true,
        keepLoginBackground: false,
        chartFix: true,
        loginTagline: 'VoIP Control Center',
        lockUserSettings: false
    };
    var ACCENTS = {
        cyan: ['#00e5ff', '#ff2bd6'],
        magenta: ['#ff3fd8', '#7c5cff'],
        matrix: ['#39ff88', '#00d0ff'],
        amber: ['#ffb020', '#ff4d6d'],
        violet: ['#a78bff', '#00e5ff'],
        ice: ['#7cc4ff', '#c9f2ff']
    };
    var BACKGROUNDS = ['network', 'grid', 'static', 'off'];

    function readJSON(key) {
        try {
            var v = window.localStorage.getItem(key);
            return v ? JSON.parse(v) : null;
        } catch (e) {
            return null;
        }
    }

    function writeJSON(key, value) {
        try {
            if (value === null || value === undefined) {
                window.localStorage.removeItem(key);
            } else {
                window.localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (e) { /* private mode / blocked storage */ }
    }

    function sanitize(src) {
        var out = {};
        if (!src || typeof src !== 'object') {
            return out;
        }
        Object.keys(DEFAULTS).forEach(function (k) {
            if (!(k in src)) {
                return;
            }
            var v = src[k];
            var d = DEFAULTS[k];
            if (typeof d === 'boolean') {
                out[k] = !!v;
            } else if (typeof d === 'number') {
                v = Number(v);
                if (isFinite(v)) {
                    out[k] = v;
                }
            } else if (typeof v === 'string') {
                out[k] = v.slice(0, 120);
            }
        });
        if (out.accent && !ACCENTS[out.accent]) {
            delete out.accent;
        }
        if (out.background && BACKGROUNDS.indexOf(out.background) === -1) {
            delete out.background;
        }
        return out;
    }

    var serverCfg = sanitize(window.MBF_CONFIG);
    var userCfg = sanitize(readJSON(LS_SETTINGS));
    var cfg = {};

    function recompute() {
        cfg = Object.assign({}, DEFAULTS, serverCfg, (serverCfg.lockUserSettings ? {} : userCfg));
        cfg.hudPollSeconds = Math.max(5, Math.min(300, cfg.hudPollSeconds || 10));
    }
    recompute();

    var urlOff = /[?&#]mbf=off\b/.test(window.location.search + window.location.hash);

    function isOn() {
        return cfg.enabled && !urlOff;
    }

    function setUser(key, value) {
        if (serverCfg.lockUserSettings) {
            return;
        }
        userCfg[key] = value;
        userCfg = sanitize(userCfg);
        writeJSON(LS_SETTINGS, userCfg);
        recompute();
        applyAll();
    }

    function resetUser() {
        userCfg = {};
        writeJSON(LS_SETTINGS, null);
        recompute();
        applyAll();
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */
    function h(tag, attrs, children) {
        var el = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                var v = attrs[k];
                if (v === undefined || v === null || v === false) {
                    return;
                }
                if (k === 'class') {
                    el.className = v;
                } else if (k === 'text') {
                    el.textContent = v;
                } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
                    el.addEventListener(k.slice(2), v);
                } else if (k === 'style' && typeof v === 'object') {
                    Object.keys(v).forEach(function (s) { el.style[s] = v[s]; });
                } else {
                    el.setAttribute(k, v === true ? '' : v);
                }
            });
        }
        (children || []).forEach(function (c) {
            if (c === null || c === undefined || c === false) {
                return;
            }
            el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return el;
    }

    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function hhmmss(d) {
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function utcHHMM(d) {
        return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    }

    function stripHtml(s) {
        var d = document.createElement('div');
        d.innerHTML = String(s == null ? '' : s);
        return (d.textContent || '').trim();
    }

    function translate(text) {
        text = String(text == null ? '' : text);
        var m = text.match(/^\s*t\(\s*(['"])([\s\S]*)\1\s*\)\s*$/);
        if (m) {
            try {
                return typeof window.t === 'function' ? window.t(m[2]) : m[2];
            } catch (e) {
                return m[2];
            }
        }
        return text;
    }

    function safeIconCls(cls) {
        return String(cls || '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
    }

    function debounce(fn, ms) {
        var t;
        return function () {
            var args = arguments;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(null, args); }, ms);
        };
    }

    function extReady() {
        return !!(window.Ext && window.Ext.ComponentQuery && window.Ext.onReady);
    }

    function isMac() {
        return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    }

    /* ------------------------------------------------------------------ */
    /* 1. Stylesheet, fonts, <html> classes                                */
    /* ------------------------------------------------------------------ */
    function injectCss() {
        if (document.getElementById('mbf-css')) {
            return;
        }
        var href = BASE + 'mbf.css' + QS;
        if (document.readyState === 'loading' && scriptEl && !scriptEl.async && !scriptEl.defer) {
            // Parser-inserted => render-blocking, so the theme is in place
            // before ExtJS measures anything (no flash, correct metrics).
            document.write('<link id="mbf-css" rel="stylesheet" href="' + href.replace(/"/g, '&quot;') + '">');
        } else {
            document.head.appendChild(h('link', { id: 'mbf-css', rel: 'stylesheet', href: href }));
        }
    }

    function injectFonts() {
        if (!cfg.googleFonts || !isOn() || document.getElementById('mbf-fonts')) {
            return;
        }
        var head = document.head || document.getElementsByTagName('head')[0];
        head.appendChild(h('link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }));
        head.appendChild(h('link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' }));
        // Non-blocking on purpose: if Google is unreachable the panel still
        // loads instantly with the system font stack.
        head.appendChild(h('link', {
            id: 'mbf-fonts',
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Orbitron:wght@500;600;700;800&display=swap'
        }));
    }

    var themeFamily = 'glyph';

    function detectFamily() {
        var hrefs = [];
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < links.length; i++) {
            if (links[i].id !== 'mbf-css' && links[i].id !== 'mbf-fonts') {
                hrefs.push(links[i].href || '');
            }
        }
        var manifest = window.Ext && window.Ext.manifest;
        var s = [
            String(window.theme || ''),
            hrefs.join(' '),
            typeof manifest === 'string' ? manifest : (manifest && (manifest.theme || manifest.name || '')) || ''
        ].join(' ').toLowerCase();
        if (window.isTablet || /triton/.test(s)) {
            themeFamily = 'glyph';
        } else if (/neptune|crisp|classic|gray/.test(s)) {
            themeFamily = 'sprite';
        } else {
            themeFamily = 'glyph';
        }
        root.classList.toggle('mbf-sprite', themeFamily === 'sprite');
        root.classList.toggle('mbf-glyph', themeFamily === 'glyph');
    }

    function applyRoot() {
        var on = isOn();
        root.classList.toggle('mbf', on);
        root.setAttribute('data-mbf-accent', cfg.accent);
        root.setAttribute('data-mbf-bg', cfg.background);
        root.classList.toggle('mbf-noglass', !cfg.glass);
        root.classList.toggle('mbf-still', !cfg.motion);
        root.classList.toggle('mbf-keep-loginbg', !!cfg.keepLoginBackground);
        root.classList.toggle('mbf-chartfix', !!cfg.chartFix);
        detectFamily();
    }

    var relayout = debounce(function () {
        if (!extReady()) {
            return;
        }
        try {
            window.Ext.ComponentQuery.query('viewport').forEach(function (v) {
                v.updateLayout();
            });
            if (window.Ext.WindowManager) {
                window.Ext.WindowManager.each(function (w) {
                    if (w && w.isVisible && w.isVisible() && w.updateLayout) {
                        w.updateLayout();
                    }
                });
            }
        } catch (e) { /* layout is best effort */ }
        positionHud();
    }, 150);

    function watchFonts() {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(relayout);
            if (document.fonts.addEventListener) {
                document.fonts.addEventListener('loadingdone', relayout);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* 2. Animated background                                              */
    /* ------------------------------------------------------------------ */
    var BG = {
        el: null, ctx: null, w: 0, h: 0, nodes: [], pulses: [],
        raf: 0, last: 0, lastPulse: 0, rgb: '0, 229, 255', rgb2: '255, 43, 214',
        mx: -9999, my: -9999
    };
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

    function readAccent() {
        var cs = window.getComputedStyle(root);
        BG.rgb = (cs.getPropertyValue('--mbf-accent-rgb') || '0, 229, 255').trim() || '0, 229, 255';
        BG.rgb2 = (cs.getPropertyValue('--mbf-accent2-rgb') || '255, 43, 214').trim() || '255, 43, 214';
    }

    function newNode() {
        return {
            x: Math.random() * BG.w,
            y: Math.random() * BG.h,
            vx: (Math.random() - 0.5) * 0.28,
            vy: (Math.random() - 0.5) * 0.28,
            r: 0.8 + Math.random() * 1.6,
            p: Math.random() * Math.PI * 2
        };
    }

    function bgResize() {
        if (!BG.el) {
            return;
        }
        var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        BG.w = window.innerWidth;
        BG.h = window.innerHeight;
        BG.el.width = Math.round(BG.w * dpr);
        BG.el.height = Math.round(BG.h * dpr);
        BG.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var count = Math.round(Math.min(95, Math.max(28, (BG.w * BG.h) / 22000)));
        while (BG.nodes.length < count) {
            BG.nodes.push(newNode());
        }
        BG.nodes.length = count;
        if (!bgAnimated()) {
            bgDraw(0, 1);
        }
    }

    function bgAnimated() {
        return cfg.motion && cfg.background === 'network' && !(reduceMotion && reduceMotion.matches);
    }

    function bgDraw(ts, dt) {
        var ctx = BG.ctx;
        var nodes = BG.nodes;
        var n = nodes.length;
        var maxD = 150;
        var maxD2 = maxD * maxD;
        var i, j, a, b, dx, dy, d2, alpha;

        ctx.clearRect(0, 0, BG.w, BG.h);

        for (i = 0; i < n; i++) {
            a = nodes[i];
            a.x += a.vx * dt;
            a.y += a.vy * dt;
            if (a.x < -20) { a.x = BG.w + 20; }
            if (a.x > BG.w + 20) { a.x = -20; }
            if (a.y < -20) { a.y = BG.h + 20; }
            if (a.y > BG.h + 20) { a.y = -20; }
        }

        ctx.lineWidth = 1;
        for (i = 0; i < n; i++) {
            a = nodes[i];
            for (j = i + 1; j < n; j++) {
                b = nodes[j];
                dx = a.x - b.x;
                dy = a.y - b.y;
                d2 = dx * dx + dy * dy;
                if (d2 < maxD2) {
                    alpha = (1 - d2 / maxD2) * 0.26;
                    ctx.strokeStyle = 'rgba(' + BG.rgb + ',' + alpha.toFixed(3) + ')';
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }
            // cursor "probe"
            dx = a.x - BG.mx;
            dy = a.y - BG.my;
            d2 = dx * dx + dy * dy;
            if (d2 < 32000) {
                alpha = (1 - d2 / 32000) * 0.45;
                ctx.strokeStyle = 'rgba(' + BG.rgb2 + ',' + alpha.toFixed(3) + ')';
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(BG.mx, BG.my);
                ctx.stroke();
            }
        }

        for (i = 0; i < n; i++) {
            a = nodes[i];
            alpha = 0.45 + 0.4 * Math.sin(ts * 0.002 + a.p);
            ctx.fillStyle = 'rgba(' + BG.rgb + ',' + alpha.toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
            ctx.fill();
        }

        if (!ts) {
            return;
        }

        // "call" packets travelling along links
        if (ts - BG.lastPulse > 600 && BG.pulses.length < 7 && n > 1) {
            BG.lastPulse = ts;
            a = nodes[(Math.random() * n) | 0];
            var best = null;
            var bestD = maxD2;
            for (j = 0; j < n; j++) {
                b = nodes[j];
                if (b === a) {
                    continue;
                }
                dx = a.x - b.x;
                dy = a.y - b.y;
                d2 = dx * dx + dy * dy;
                if (d2 < bestD && Math.random() < 0.6) {
                    bestD = d2;
                    best = b;
                }
            }
            if (best) {
                BG.pulses.push({ a: a, b: best, t0: ts, dur: 900 + Math.random() * 900, c: Math.random() < 0.3 ? BG.rgb2 : BG.rgb });
            }
        }
        for (i = BG.pulses.length - 1; i >= 0; i--) {
            var p = BG.pulses[i];
            var k = (ts - p.t0) / p.dur;
            if (k >= 1) {
                BG.pulses.splice(i, 1);
                continue;
            }
            var x = p.a.x + (p.b.x - p.a.x) * k;
            var y = p.a.y + (p.b.y - p.a.y) * k;
            var tx = p.a.x + (p.b.x - p.a.x) * Math.max(0, k - 0.25);
            var ty = p.a.y + (p.b.y - p.a.y) * Math.max(0, k - 0.25);
            var grad = ctx.createLinearGradient(tx, ty, x, y);
            grad.addColorStop(0, 'rgba(' + p.c + ',0)');
            grad.addColorStop(1, 'rgba(' + p.c + ',0.9)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.lineWidth = 1;
            ctx.fillStyle = 'rgba(' + p.c + ',1)';
            ctx.shadowColor = 'rgba(' + p.c + ',0.9)';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    function bgFrame(ts) {
        BG.raf = window.requestAnimationFrame(bgFrame);
        if (ts - BG.last < 33) {
            return; // ~30 fps is plenty for ambience and kind to CPUs
        }
        var dt = BG.last ? Math.min(3, (ts - BG.last) / 16.7) : 1;
        BG.last = ts;
        bgDraw(ts, dt);
    }

    function bgStop() {
        if (BG.raf) {
            window.cancelAnimationFrame(BG.raf);
        }
        BG.raf = 0;
        BG.last = 0;
    }

    function bgStart() {
        bgStop();
        var want = isOn() && (cfg.background === 'network' || cfg.background === 'static');
        if (!want) {
            if (BG.el && BG.el.parentNode) {
                BG.el.parentNode.removeChild(BG.el);
            }
            BG.el = null;
            return;
        }
        if (!document.body) {
            return;
        }
        if (!BG.el) {
            BG.el = h('canvas', { id: 'mbf-bg', 'aria-hidden': 'true' });
            BG.ctx = BG.el.getContext('2d');
            document.body.insertBefore(BG.el, document.body.firstChild);
        }
        readAccent();
        bgResize();
        if (bgAnimated() && !document.hidden) {
            BG.raf = window.requestAnimationFrame(bgFrame);
        } else {
            bgDraw(0, 1);
        }
    }

    /* ------------------------------------------------------------------ */
    /* 3. Login screen decoration                                          */
    /* ------------------------------------------------------------------ */
    function decorateLogin(winEl) {
        if (!isOn() || !winEl || winEl.querySelector('.mbf-login-deco')) {
            return;
        }
        var name = window.nameCustom || window.agentTitle || 'MagnusBilling';
        var clock = h('b', { text: hhmmss(new Date()) });
        var deco = h('div', { class: 'mbf-login-deco mbf-ui', 'aria-hidden': 'true' }, [
            h('div', { class: 'mbf-login-brand' }, [
                h('div', { class: 'mbf-login-brand-mark' }),
                h('div', null, [
                    h('span', { class: 'mbf-login-brand-name', text: stripHtml(name) }),
                    h('span', { class: 'mbf-login-brand-sub', text: cfg.loginTagline || '' })
                ])
            ]),
            h('div', { class: 'mbf-login-status' }, [
                h('span', null, [h('i', { class: 'mbf-dot' }), 'System ', h('b', { text: 'online' })]),
                h('span', null, ['Secure session · ', h('b', { text: window.location.protocol === 'https:' ? 'TLS' : 'HTTP' })]),
                h('span', null, ['Local ', clock])
            ])
        ]);
        winEl.appendChild(deco);
        var timer = setInterval(function () {
            if (!document.body.contains(deco)) {
                clearInterval(timer);
                return;
            }
            clock.textContent = hhmmss(new Date());
        }, 1000);
    }

    /* ------------------------------------------------------------------ */
    /* 4. Standard layout: main shell, HUD, dashboard pulse                */
    /* ------------------------------------------------------------------ */
    var MAIN = { cmp: null, ctrl: null, header: null, menu: null, center: null };

    function getMain() {
        if (!extReady()) {
            return null;
        }
        var m = window.Ext.ComponentQuery.query('main')[0];
        return m && m.rendered && !m.destroyed ? m : null;
    }

    function bindMain(main) {
        if (MAIN.cmp === main) {
            return;
        }
        MAIN.cmp = main;
        MAIN.ctrl = main.getController ? main.getController() : null;
        var ref = function (r) {
            try {
                return MAIN.ctrl && MAIN.ctrl.lookupReference(r);
            } catch (e) {
                return null;
            }
        };
        MAIN.header = ref('header');
        MAIN.menu = ref('tabPanelMenu');
        MAIN.center = ref('tabPanelCenter');
        if (MAIN.header) { MAIN.header.addCls('mbf-header'); }
        if (MAIN.menu) { MAIN.menu.addCls('mbf-menu'); }
        if (MAIN.center) { MAIN.center.addCls('mbf-center'); }
        buildHud();
    }

    var HUD = {
        el: null, calls: null, callsVal: null, spark: null, lat: null, clock: null, utc: null,
        series: [], timer: 0, clockTimer: 0, failures: 0, lastActivity: Date.now(), lastCount: null
    };

    function isAdmin() {
        try {
            return !!(window.App && window.App.user && window.App.user.isAdmin);
        } catch (e) {
            return false;
        }
    }

    ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'].forEach(function (ev) {
        window.addEventListener(ev, function () { HUD.lastActivity = Date.now(); }, { passive: true, capture: true });
    });

    function destroyHud() {
        clearTimeout(HUD.timer);
        clearInterval(HUD.clockTimer);
        if (HUD.el && HUD.el.parentNode) {
            HUD.el.parentNode.removeChild(HUD.el);
        }
        HUD.el = null;
    }

    function buildHud() {
        destroyHud();
        if (!isOn() || !cfg.hud || !MAIN.cmp || !MAIN.header || !MAIN.header.isVisible()) {
            return;
        }
        var mod = isMac() ? '⌘' : 'Ctrl';
        var chips = [];
        if (isAdmin() && window.fetch) {
            HUD.callsVal = h('b', { text: '–' });
            HUD.spark = h('canvas', { class: 'mbf-spark', width: 140, height: 40 });
            HUD.calls = h('span', {
                class: 'mbf-hud-chip mbf-hud-calls mbf-hud-btn',
                title: 'Live calls — click to open Calls Online',
                role: 'button',
                tabindex: '0',
                onclick: function () { openModuleBy('callOnLine'); }
            }, [h('i', { class: 'mbf-dot' }), 'Live calls ', HUD.callsVal, HUD.spark]);
            HUD.lat = h('b', { text: '–' });
            chips.push(HUD.calls);
            chips.push(h('span', { class: 'mbf-hud-chip mbf-hud-optional', title: 'Panel round-trip latency' }, ['Ping ', HUD.lat]));
        }
        HUD.clock = h('b', { text: hhmmss(new Date()) });
        HUD.utc = h('b', { text: utcHHMM(new Date()) });
        chips.push(h('span', { class: 'mbf-hud-chip' }, [HUD.clock, h('span', { class: 'mbf-hud-optional' }, [' UTC ', HUD.utc])]));
        if (cfg.palette) {
            chips.push(h('span', {
                class: 'mbf-hud-chip mbf-hud-btn',
                role: 'button',
                tabindex: '0',
                title: 'Search every menu and module',
                onclick: function () { openPalette(); }
            }, ['Search ', h('kbd', { text: mod }), h('kbd', { text: 'K' })]));
        }
        chips.push(h('span', {
            class: 'mbf-hud-chip mbf-hud-btn',
            role: 'button',
            tabindex: '0',
            title: 'Theme Studio',
            onclick: function () { toggleStudio(); }
        }, [h('i', { class: 'mbf-swatch-dot' }), 'Theme']));

        HUD.el = h('div', { id: 'mbf-hud', class: 'mbf-ui' }, chips);
        HUD.el.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.click) {
                e.preventDefault();
                e.target.click();
            }
        });
        document.body.appendChild(HUD.el);
        positionHud();

        HUD.clockTimer = setInterval(function () {
            var d = new Date();
            HUD.clock.textContent = hhmmss(d);
            HUD.utc.textContent = utcHHMM(d);
        }, 1000);

        if (HUD.calls) {
            HUD.failures = 0;
            pollCalls();
        }
    }

    function positionHud() {
        if (!HUD.el || !MAIN.header || !MAIN.header.el) {
            return;
        }
        var hb = MAIN.header.el.dom.getBoundingClientRect();
        if (!hb.height) {
            HUD.el.style.display = 'none';
            return;
        }
        HUD.el.style.display = '';
        HUD.el.style.top = hb.top + 'px';
        HUD.el.style.height = hb.height + 'px';
        HUD.el.classList.remove('mbf-compact');

        // Find the free gap between the logo (left) and the user/credit
        // controls (right) so the HUD never covers real buttons.
        var vw = window.innerWidth;
        var left = 0;
        var right = vw;
        var tb = MAIN.header.down && MAIN.header.down('toolbar');
        if (tb && tb.items) {
            tb.items.each(function (it) {
                if (!it.el || !it.isVisible() || (it.isXType && it.isXType('tbfill'))) {
                    return;
                }
                var r = it.el.dom.getBoundingClientRect();
                if (!r.width) {
                    return;
                }
                if (r.left + r.width / 2 < vw / 2) {
                    left = Math.max(left, r.right);
                } else {
                    right = Math.min(right, r.left);
                }
            });
        }
        var gap = right - left - 24;
        HUD.el.style.left = ((left + right) / 2) + 'px';
        var width = HUD.el.scrollWidth;
        if (width > gap) {
            Array.prototype.forEach.call(HUD.el.querySelectorAll('.mbf-hud-optional'), function (n) { n.style.display = 'none'; });
            width = HUD.el.scrollWidth;
        } else {
            Array.prototype.forEach.call(HUD.el.querySelectorAll('.mbf-hud-optional'), function (n) { n.style.display = ''; });
        }
        HUD.el.style.visibility = width > gap ? 'hidden' : 'visible';
    }

    function pollCalls() {
        clearTimeout(HUD.timer);
        if (!HUD.el || !HUD.calls) {
            return;
        }
        var next = function () {
            HUD.timer = setTimeout(pollCalls, cfg.hudPollSeconds * 1000);
        };
        // Do not keep an idle session alive: pause when the tab is hidden or
        // nobody has touched the panel for 15 minutes.
        if (document.hidden || Date.now() - HUD.lastActivity > 15 * 60 * 1000) {
            next();
            return;
        }
        var t0 = window.performance ? window.performance.now() : Date.now();
        window.fetch('index.php/callOnLine/read?page=1&start=0&limit=1&_dc=' + Date.now(), {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        }).then(function (r) {
            if (!r.ok) {
                throw new Error('HTTP ' + r.status);
            }
            return r.json();
        }).then(function (json) {
            var count = Number(json && json.count);
            if (!isFinite(count)) {
                throw new Error('bad payload');
            }
            var ms = Math.round((window.performance ? window.performance.now() : Date.now()) - t0);
            HUD.failures = 0;
            setCalls(count);
            HUD.lat.textContent = ms + ' ms';
            HUD.lat.className = ms < 150 ? 'mbf-lat-good' : (ms < 500 ? 'mbf-lat-mid' : 'mbf-lat-bad');
        }).catch(function () {
            HUD.failures++;
            if (HUD.lat) {
                HUD.lat.textContent = 'offline';
                HUD.lat.className = 'mbf-lat-bad';
            }
            if (HUD.failures >= 3 && HUD.calls) {
                HUD.calls.style.display = 'none';
            }
        }).then(next);
    }

    function setCalls(n) {
        if (HUD.calls.style.display === 'none') {
            HUD.calls.style.display = '';
        }
        if (HUD.lastCount !== null && HUD.lastCount !== n) {
            HUD.calls.classList.remove('mbf-bump');
            void HUD.calls.offsetWidth;
            HUD.calls.classList.add('mbf-bump');
        }
        HUD.lastCount = n;
        HUD.callsVal.textContent = String(n);
        if (!HUD.series.length) {
            HUD.series.push(n);
        }
        HUD.series.push(n);
        if (HUD.series.length > 40) {
            HUD.series.shift();
        }
        drawSpark();
    }

    function drawSpark() {
        var c = HUD.spark;
        if (!c) {
            return;
        }
        var ctx = c.getContext('2d');
        var w = c.width;
        var hgt = c.height;
        var s = HUD.series;
        ctx.clearRect(0, 0, w, hgt);
        if (s.length < 2) {
            return;
        }
        var max = Math.max.apply(null, s.concat([1]));
        var step = w / (s.length - 1);
        var y = function (v) { return hgt - 4 - (v / max) * (hgt - 8); };
        readAccent();
        ctx.beginPath();
        ctx.moveTo(0, y(s[0]));
        for (var i = 1; i < s.length; i++) {
            ctx.lineTo(i * step, y(s[i]));
        }
        ctx.strokeStyle = 'rgba(' + BG.rgb + ',1)';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(' + BG.rgb + ',0.8)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.lineTo(w, hgt);
        ctx.lineTo(0, hgt);
        ctx.closePath();
        var g = ctx.createLinearGradient(0, 0, 0, hgt);
        g.addColorStop(0, 'rgba(' + BG.rgb + ',0.35)');
        g.addColorStop(1, 'rgba(' + BG.rgb + ',0)');
        ctx.fillStyle = g;
        ctx.fill();
    }

    function watchDashboard() {
        var cards = document.querySelectorAll('.weather-panel:not([data-mbf-obs])');
        Array.prototype.forEach.call(cards, function (card) {
            card.setAttribute('data-mbf-obs', '1');
            if (!window.MutationObserver) {
                return;
            }
            var mo = new MutationObserver(function () {
                card.classList.remove('mbf-pulse');
                void card.offsetWidth;
                card.classList.add('mbf-pulse');
            });
            mo.observe(card, { childList: true, subtree: true, characterData: true });
            card.addEventListener('animationend', function () { card.classList.remove('mbf-pulse'); });
        });
    }

    /* ------------------------------------------------------------------ */
    /* 5. Command palette (Ctrl/Cmd + K)                                   */
    /* ------------------------------------------------------------------ */
    function collectModules() {
        var out = [];
        var seen = {};
        var menu = window.App && window.App.user && window.App.user.menu;
        if (!menu || !menu.length) {
            return out;
        }
        var walk = function (rows, group, path) {
            (rows || []).forEach(function (item) {
                if (!item) {
                    return;
                }
                var text = stripHtml(translate(item.text));
                var hasKids = item.rows && item.rows.length;
                if (item.leaf || (!hasKids && item.module)) {
                    var key = (item.module || '') + '|' + text;
                    if (!seen[key] && text) {
                        seen[key] = 1;
                        out.push({
                            type: 'module',
                            text: text,
                            group: group,
                            path: path.join(' › '),
                            module: item.module,
                            iconCls: safeIconCls(item.iconCls),
                            raw: item
                        });
                    }
                }
                if (hasKids) {
                    walk(item.rows, group, path.concat([text]));
                }
            });
        };
        menu.forEach(function (cat) {
            var group = stripHtml(translate(cat.text));
            walk(cat.rows, group, []);
        });
        return out;
    }

    function openModule(item) {
        var main = getMain();
        if (!main) {
            return false;
        }
        bindMain(main);
        var raw = item.raw || {};
        var data = {
            text: item.text,
            leaf: true,
            module: raw.module,
            action: raw.action,
            iconCls: raw.iconCls
        };
        var fakeRecord = { get: function (k) { return data[k]; }, data: data };
        try {
            MAIN.ctrl.createTabStandard(null, fakeRecord);
        } catch (e) {
            return false;
        }
        var recent = (readJSON(LS_RECENT) || []).filter(function (k) { return k !== item.module + '|' + item.text; });
        recent.unshift(item.module + '|' + item.text);
        writeJSON(LS_RECENT, recent.slice(0, 6));
        return true;
    }

    function openModuleBy(moduleName) {
        var mods = collectModules();
        for (var i = 0; i < mods.length; i++) {
            if (mods[i].module === moduleName) {
                return openModule(mods[i]);
            }
        }
        return false;
    }

    function centerTabs() {
        var main = getMain();
        if (!main) {
            return null;
        }
        bindMain(main);
        return MAIN.center;
    }

    function buildActions() {
        var acts = [];
        var tp = centerTabs();
        var add = function (text, icon, run, meta) {
            acts.push({ type: 'action', text: text, icon: icon, run: run, meta: meta || '', group: 'Actions' });
        };
        if (tp) {
            add('Go to Home dashboard', '⌂', function () { tp.setActiveTab(0); });
            add('Close current tab', '✕', function () {
                var a = tp.getActiveTab();
                if (a && a.closable) { a.close(); }
            });
            add('Close all other tabs', '✕', function () {
                var a = tp.getActiveTab();
                var list = [];
                tp.items.each(function (t) { if (t !== a && t.closable) { list.push(t); } });
                list.forEach(function (t) { t.close(); });
            });
            add('Reload current list', '↻', function () {
                var a = tp.getActiveTab();
                var g = a && (a.isXType && a.isXType('grid') ? a : (a.down && a.down('grid')));
                if (g && g.getStore) { g.getStore().reload(); }
            });
            if (MAIN.menu) {
                add('Toggle side menu', '☰', function () {
                    if (MAIN.menu.getCollapsed && MAIN.menu.getCollapsed()) { MAIN.menu.expand(); } else if (MAIN.menu.collapse) { MAIN.menu.collapse(); }
                });
            }
        }
        add('Theme Studio', '◐', function () { toggleStudio(true); });
        add(isOn() ? 'Switch to stock MagnusBilling look' : 'Enable futuristic theme', '✦', function () { setUser('enabled', !cfg.enabled); }, 'Ctrl+Alt+F');
        add(cfg.motion ? 'Pause animations' : 'Resume animations', '❚❚', function () { setUser('motion', !cfg.motion); });
        Object.keys(ACCENTS).forEach(function (k) {
            add('Accent: ' + k.charAt(0).toUpperCase() + k.slice(1), '●', function () { setUser('accent', k); }, cfg.accent === k ? 'active' : '');
        });
        BACKGROUNDS.forEach(function (k) {
            add('Background: ' + k, '▦', function () { setUser('background', k); }, cfg.background === k ? 'active' : '');
        });
        if (document.documentElement.requestFullscreen) {
            add(document.fullscreenElement ? 'Exit full screen' : 'Full screen', '⛶', function () {
                if (document.fullscreenElement) { document.exitFullscreen(); } else { document.documentElement.requestFullscreen(); }
            });
        }
        return acts;
    }

    function scoreText(q, text) {
        text = text.toLowerCase();
        var idx = text.indexOf(q);
        if (idx === 0) {
            return 100 - Math.min(20, text.length * 0.1);
        }
        if (idx > 0) {
            var wordStart = text.charAt(idx - 1) === ' ' || text.charAt(idx - 1) === '-';
            return (wordStart ? 85 : 70) - Math.min(20, idx * 0.5);
        }
        // subsequence ("sipu" -> "SIP Users")
        var ti = 0;
        var qi = 0;
        var s = 0;
        var prev = -2;
        while (ti < text.length && qi < q.length) {
            if (text.charAt(ti) === q.charAt(qi)) {
                s += (ti === prev + 1) ? 3 : 1;
                if (ti === 0 || text.charAt(ti - 1) === ' ') {
                    s += 2;
                }
                prev = ti;
                qi++;
            }
            ti++;
        }
        return qi === q.length ? 10 + s : -1;
    }

    function rank(items, query) {
        var words = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) {
            return items.slice();
        }
        var res = [];
        items.forEach(function (it) {
            var total = 0;
            for (var i = 0; i < words.length; i++) {
                var s1 = scoreText(words[i], it.text);
                var s2 = scoreText(words[i], (it.group || '') + ' ' + (it.path || '') + ' ' + (it.module || '')) * 0.5;
                var s = Math.max(s1, s2);
                if (s < 0) {
                    return;
                }
                total += s;
            }
            res.push({ it: it, s: total + (it.type === 'module' ? 5 : 0) });
        });
        res.sort(function (a, b) { return b.s - a.s; });
        return res.map(function (r) { return r.it; });
    }

    function highlight(text, query) {
        var frag = document.createDocumentFragment();
        var q = (query || '').trim().toLowerCase().split(/\s+/)[0] || '';
        var idx = q ? text.toLowerCase().indexOf(q) : -1;
        if (idx < 0) {
            frag.appendChild(document.createTextNode(text));
            return frag;
        }
        frag.appendChild(document.createTextNode(text.slice(0, idx)));
        frag.appendChild(h('mark', { text: text.slice(idx, idx + q.length) }));
        frag.appendChild(document.createTextNode(text.slice(idx + q.length)));
        return frag;
    }

    var PAL = { el: null, input: null, list: null, items: [], active: 0, prevFocus: null };

    function closePalette() {
        if (PAL.el && PAL.el.parentNode) {
            PAL.el.parentNode.removeChild(PAL.el);
        }
        PAL.el = null;
        if (PAL.prevFocus && PAL.prevFocus.focus) {
            try { PAL.prevFocus.focus(); } catch (e) { /* ignore */ }
        }
    }

    function runItem(it) {
        closePalette();
        if (!it) {
            return;
        }
        if (it.type === 'module') {
            openModule(it);
        } else if (it.run) {
            it.run();
        }
    }

    function renderPalette() {
        var q = PAL.input.value.trim();
        var modules = collectModules();
        var actions = buildActions();
        var list = PAL.list;
        list.innerHTML = '';
        var shown = [];

        var addGroup = function (label) {
            list.appendChild(h('li', { class: 'mbf-palette-group', role: 'presentation', text: label }));
        };
        var addItem = function (it) {
            var idx = shown.length;
            shown.push(it);
            var icon = it.type === 'module'
                ? h('span', { class: 'mbf-pi-icon' }, [h('span', { class: it.iconCls || 'x-fa fa-circle-o' })])
                : h('span', { class: 'mbf-pi-icon', text: it.icon || '•' });
            var li = h('li', {
                class: 'mbf-palette-item',
                role: 'option',
                id: 'mbf-pi-' + idx,
                onmousemove: function () { setActive(idx); },
                onclick: function () { runItem(it); }
            }, [
                icon,
                h('span', { class: 'mbf-pi-text' }, [highlight(it.text, q)]),
                h('span', { class: 'mbf-pi-meta', text: it.type === 'module' ? (it.path ? it.group + ' › ' + it.path : it.group) : it.meta })
            ]);
            list.appendChild(li);
        };

        if (!q) {
            var recentKeys = readJSON(LS_RECENT) || [];
            var recent = recentKeys.map(function (k) {
                for (var i = 0; i < modules.length; i++) {
                    if (modules[i].module + '|' + modules[i].text === k) { return modules[i]; }
                }
                return null;
            }).filter(Boolean);
            if (recent.length) {
                addGroup('Recent');
                recent.forEach(addItem);
            }
            var lastGroup = null;
            modules.forEach(function (m) {
                if (m.group !== lastGroup) {
                    addGroup(m.group || 'Modules');
                    lastGroup = m.group;
                }
                addItem(m);
            });
            addGroup('Actions');
            actions.forEach(addItem);
        } else {
            var ranked = rank(modules.concat(actions), q).slice(0, 60);
            ranked.forEach(addItem);
        }

        if (!shown.length) {
            list.appendChild(h('li', { class: 'mbf-palette-empty', text: modules.length ? 'No match for “' + q + '”' : 'Log in to search modules. Theme actions are below.' }));
        }
        PAL.items = shown;
        setActive(0);
    }

    function setActive(i) {
        if (!PAL.items.length) {
            return;
        }
        i = (i + PAL.items.length) % PAL.items.length;
        var prev = PAL.list.querySelector('.mbf-active');
        if (prev) {
            prev.classList.remove('mbf-active');
        }
        var el = document.getElementById('mbf-pi-' + i);
        if (el) {
            el.classList.add('mbf-active');
            PAL.input.setAttribute('aria-activedescendant', el.id);
            var lr = PAL.list.getBoundingClientRect();
            var er = el.getBoundingClientRect();
            if (er.top < lr.top) {
                PAL.list.scrollTop -= (lr.top - er.top) + 4;
            } else if (er.bottom > lr.bottom) {
                PAL.list.scrollTop += (er.bottom - lr.bottom) + 4;
            }
        }
        PAL.active = i;
    }

    function openPalette() {
        if (!cfg.palette) {
            return;
        }
        if (PAL.el) {
            PAL.input.focus();
            return;
        }
        closeStudio();
        PAL.prevFocus = document.activeElement;
        PAL.input = h('input', {
            class: 'mbf-palette-input',
            type: 'text',
            placeholder: 'Jump to a module — SIP Users, Caller ID, Rates, CDR… or type a command',
            'aria-label': 'Search modules and commands',
            role: 'combobox',
            'aria-expanded': 'true',
            'aria-controls': 'mbf-palette-list',
            autocomplete: 'off',
            spellcheck: 'false'
        });
        PAL.list = h('ul', { class: 'mbf-palette-list', id: 'mbf-palette-list', role: 'listbox' });
        var mod = isMac() ? '⌘' : 'Ctrl';
        var box = h('div', { class: 'mbf-palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, [
            h('div', { class: 'mbf-palette-input-row' }, [h('span', { class: 'mbf-palette-icon' }), PAL.input]),
            PAL.list,
            h('div', { class: 'mbf-palette-foot' }, [
                h('span', null, [h('kbd', { text: '↑' }), ' ', h('kbd', { text: '↓' }), ' navigate']),
                h('span', null, [h('kbd', { text: 'Enter' }), ' open']),
                h('span', null, [h('kbd', { text: 'Esc' }), ' close']),
                h('span', null, [h('kbd', { text: mod }), ' ', h('kbd', { text: 'K' }), ' toggle'])
            ])
        ]);
        PAL.el = h('div', { class: 'mbf-palette-backdrop mbf-ui' }, [box]);
        PAL.el.addEventListener('mousedown', function (e) {
            if (e.target === PAL.el) {
                closePalette();
            }
        });
        PAL.el.addEventListener('keydown', function (e) {
            e.stopPropagation(); // keep ExtJS key navigation out of the palette
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(PAL.active + 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(PAL.active - 1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                runItem(PAL.items[PAL.active]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closePalette();
            }
        });
        PAL.input.addEventListener('input', renderPalette);
        document.body.appendChild(PAL.el);
        renderPalette();
        // Focus synchronously so keystrokes typed right after Ctrl+K are not
        // lost; retry once in case ExtJS pulls focus back to a grid.
        PAL.input.focus();
        setTimeout(function () {
            if (PAL.input && document.activeElement !== PAL.input) {
                PAL.input.focus();
            }
        }, 0);
    }

    /* ------------------------------------------------------------------ */
    /* 6. Theme Studio                                                     */
    /* ------------------------------------------------------------------ */
    var STUDIO = { el: null };

    function closeStudio() {
        if (STUDIO.el && STUDIO.el.parentNode) {
            STUDIO.el.parentNode.removeChild(STUDIO.el);
        }
        STUDIO.el = null;
    }

    function toggleStudio(forceOpen) {
        if (STUDIO.el && !forceOpen) {
            closeStudio();
            return;
        }
        closeStudio();
        renderStudio();
    }

    function seg(label, key, options, note) {
        return h('div', { class: 'mbf-studio-row' }, [
            h('div', { class: 'mbf-studio-label', text: label }),
            h('div', { class: 'mbf-seg', role: 'group', 'aria-label': label }, options.map(function (o) {
                return h('button', {
                    type: 'button',
                    'aria-pressed': String(cfg[key] === o[0]),
                    onclick: function () { setUser(key, o[0]); renderStudio(); }
                }, [o[1]]);
            })),
            note ? h('div', { class: 'mbf-studio-note', text: note }) : null
        ]);
    }

    function renderStudio() {
        var top = MAIN.header && MAIN.header.el ? MAIN.header.el.dom.getBoundingClientRect().bottom + 10 : 16;
        var locked = !!serverCfg.lockUserSettings;
        var body = h('div', { class: 'mbf-studio-body' }, [
            h('div', { class: 'mbf-studio-row' }, [
                h('div', { class: 'mbf-studio-label', text: 'Accent' }),
                h('div', { class: 'mbf-swatches' }, Object.keys(ACCENTS).map(function (k) {
                    return h('button', {
                        type: 'button',
                        class: 'mbf-swatch',
                        title: k,
                        'aria-label': 'Accent ' + k,
                        'aria-pressed': String(cfg.accent === k),
                        style: { background: 'linear-gradient(135deg,' + ACCENTS[k][0] + ',' + ACCENTS[k][1] + ')' },
                        onclick: function () { setUser('accent', k); renderStudio(); }
                    });
                }))
            ]),
            seg('Background', 'background', [['network', 'Network'], ['grid', 'Grid'], ['static', 'Static'], ['off', 'Off']]),
            seg('Glass blur', 'glass', [[true, 'On'], [false, 'Off']], 'Turn off on slow PCs.'),
            seg('Animations', 'motion', [[true, 'On'], [false, 'Off']]),
            seg('Live HUD', 'hud', [[true, 'On'], [false, 'Off']]),
            seg('Futuristic fonts', 'googleFonts', [[true, 'On'], [false, 'System']], 'Font changes apply after a reload.'),
            seg('Theme', 'enabled', [[true, 'Futuristic'], [false, 'Stock']]),
            locked ? h('div', { class: 'mbf-studio-note', text: 'Your administrator has locked these settings.' }) : null,
            h('button', { type: 'button', class: 'mbf-studio-reset', onclick: function () { resetUser(); renderStudio(); } }, ['Reset to server defaults'])
        ]);
        var panel = h('div', { class: 'mbf-studio mbf-ui', role: 'dialog', 'aria-label': 'Theme Studio', style: { top: top + 'px' } }, [
            h('div', { class: 'mbf-studio-head' }, [
                h('span', { class: 'mbf-studio-title', text: 'Theme Studio' }),
                h('button', { type: 'button', class: 'mbf-studio-close', 'aria-label': 'Close', onclick: closeStudio }, ['×'])
            ]),
            body
        ]);
        panel.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Escape') {
                closeStudio();
            }
        });
        if (STUDIO.el && STUDIO.el.parentNode) {
            STUDIO.el.parentNode.replaceChild(panel, STUDIO.el);
        } else {
            document.body.appendChild(panel);
        }
        STUDIO.el = panel;
    }

    /* ------------------------------------------------------------------ */
    /* 7. Wiring                                                           */
    /* ------------------------------------------------------------------ */
    function applyAll() {
        applyRoot();
        if (!isOn()) {
            Array.prototype.forEach.call(document.querySelectorAll('.mbf-login-deco'), function (n) {
                n.parentNode.removeChild(n);
            });
        } else {
            queueScan();
        }
        injectFonts();
        if (document.body) {
            bgStart();
        }
        if (MAIN.cmp) {
            buildHud();
        }
        relayout();
    }

    var scanQueued = false;

    function scan() {
        scanQueued = false;
        var loginWin = document.querySelector('.auth-locked-window');
        root.classList.toggle('mbf-login-active', !!loginWin);
        if (loginWin) {
            decorateLogin(loginWin);
        }
        var main = getMain();
        if (main && MAIN.cmp !== main) {
            detectFamily();
            bindMain(main);
        }
        if (isOn()) {
            watchDashboard();
        }
    }

    function queueScan() {
        if (scanQueued) {
            return;
        }
        scanQueued = true;
        setTimeout(scan, 300);
    }

    document.addEventListener('keydown', function (e) {
        var k = (e.key || '').toLowerCase();
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k === 'k') {
            e.preventDefault();
            e.stopPropagation();
            if (PAL.el) {
                closePalette();
            } else {
                openPalette();
            }
        } else if (e.ctrlKey && e.altKey && k === 'f') {
            e.preventDefault();
            setUser('enabled', !cfg.enabled);
        }
    }, true);

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            bgStop();
        } else if (BG.el && bgAnimated()) {
            BG.raf = window.requestAnimationFrame(bgFrame);
        }
    });

    window.addEventListener('resize', debounce(function () {
        bgResize();
        positionHud();
    }, 150));

    window.addEventListener('mousemove', function (e) {
        BG.mx = e.clientX;
        BG.my = e.clientY;
    }, { passive: true });
    document.addEventListener('mouseleave', function () {
        BG.mx = BG.my = -9999;
    });

    if (reduceMotion && reduceMotion.addEventListener) {
        reduceMotion.addEventListener('change', bgStart);
    }

    // Boot sequence
    applyRoot();
    injectCss();
    injectFonts();
    watchFonts();

    function onDomReady() {
        bgStart();
        scan();
        if (window.MutationObserver) {
            new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
        }
        // Re-detect the base theme once ExtJS has injected its stylesheet.
        var tries = 0;
        (function waitExt() {
            if (extReady()) {
                window.Ext.onReady(function () {
                    detectFamily();
                    relayout();
                    queueScan();
                });
                return;
            }
            if (++tries < 600) {
                setTimeout(waitExt, 200);
            }
        })();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onDomReady);
    } else {
        onDomReady();
    }

    window.MBF = {
        version: VERSION,
        config: function () { return Object.assign({}, cfg); },
        set: setUser,
        reset: resetUser,
        openPalette: openPalette,
        openStudio: function () { toggleStudio(true); },
        openModule: openModuleBy,
        enable: function () { setUser('enabled', true); },
        disable: function () { setUser('enabled', false); }
    };

    if (window.console && window.console.info) {
        window.console.info('%c MBF %c MagnusBilling Futuristic Theme v' + VERSION + ' — Ctrl/Cmd+K to search, ?mbf=off for stock look',
            'background:#00e5ff;color:#031018;font-weight:700;border-radius:3px;padding:1px 4px',
            'color:#00e5ff');
    }
})(window, document);
