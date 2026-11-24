// Barcode input from USB/Bluetooth scanners (which type like a fast keyboard + Enter)
// and from the device camera (BarcodeDetector, with a bundled ZXing fallback).
import { beep, html, icon, modal, toast } from "./ui.js";

const GS = "\x1d"; // field separator inside GS1 codes (DataMatrix, QR, GS1-128)
// Scanners in keyboard mode send the separator as Ctrl+] (the ASCII control key for code 29).
const isSeparatorKey = (e) => e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "]" || e.code === "BracketRight");

let handler = null;
let buffer = "";
let lastKey = 0;
let intervals = [];

/** Registers the current page's scan handler (replaces any previous one). */
export function onScan(fn) {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

export function clearScanHandler() {
  handler = null;
}

export function emitScan(code, source = "manual") {
  const value = String(code ?? "").trim();
  if (value && handler) handler(value, source);
}

// Scanner "keyboards" send characters a few ms apart. When the focus is not in a text field,
// collect those bursts and treat Enter as the end of a scan.
document.addEventListener(
  "keydown",
  (e) => {
    const target = e.target;
    // In a scan field, keep the separator in the text so the server can split the GS1 fields.
    if (target instanceof HTMLInputElement && target.classList.contains("scan-input") && isSeparatorKey(e)) {
      e.preventDefault();
      target.setRangeText(GS, target.selectionStart ?? target.value.length, target.selectionEnd ?? target.value.length, "end");
      return;
    }
    const typing = target instanceof HTMLElement && (target.matches("input, textarea, select, [contenteditable=true]") || target.closest("dialog"));
    if (!typing && buffer && isSeparatorKey(e)) {
      e.preventDefault();
      lastKey = performance.now();
      buffer += GS;
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = performance.now();
    const gap = now - lastKey;
    lastKey = now;
    if (gap > 80) {
      buffer = "";
      intervals = [];
    }
    if (e.key === "Enter") {
      const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 999;
      if (buffer.length >= 3 && avg < 50) {
        e.preventDefault();
        emitScan(buffer, "scanner");
      }
      buffer = "";
      intervals = [];
      return;
    }
    if (e.key.length === 1) {
      if (buffer) intervals.push(gap);
      buffer += e.key;
    }
  },
  true
);

// ---- camera -------------------------------------------------------------------

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code", "data_matrix"];
let zxingLoad = null;

function loadZxing() {
  zxingLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/zxing-browser.min.js";
    s.onload = () => resolve(window.ZXingBrowser);
    s.onerror = () => reject(new Error("Could not load the camera scanner"));
    document.head.append(s);
  });
  return zxingLoad;
}

/**
 * Opens a camera scanning dialog. continuous: keep scanning (POS / stock count) until closed.
 * Each detected code goes to onCode (defaults to the page's scan handler).
 */
export async function openCamera({ continuous = true, onCode = (code) => emitScan(code, "camera"), title = "Scan with camera" } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera scanning needs HTTPS (or localhost) and a browser with camera access", "error", 6000);
    return;
  }
  let stream;
  let stopped = false;
  let zxControls = null;
  const recent = new Map();
  const { el, close, result } = modal({
    title,
    body: html`
      <div class="camera"><video playsinline muted></video><div class="reticle"></div><div class="last hidden"></div></div>
      <div class="row between" style="margin-top:10px">
        <span class="muted small">Hold the barcode inside the frame.</span>
        <select class="input sm" style="width:auto" data-cam aria-label="Camera"></select>
      </div>`,
    actions: [{ label: "Done", kind: "primary", value: true }]
  });
  const video = el.querySelector("video");
  const lastEl = el.querySelector(".last");
  const camSelect = el.querySelector("[data-cam]");

  const found = (code) => {
    const now = Date.now();
    if (recent.has(code) && now - recent.get(code) < 1800) return;
    recent.set(code, now);
    beep(true);
    lastEl.textContent = code;
    lastEl.classList.remove("hidden");
    onCode(code);
    if (!continuous) close(code);
  };

  const stop = () => {
    stopped = true;
    zxControls?.stop?.();
    stream?.getTracks().forEach((t) => t.stop());
  };
  result.then(stop);

  async function start(deviceId) {
    stream?.getTracks().forEach((t) => t.stop());
    zxControls?.stop?.();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false
      });
    } catch (err) {
      toast(err.name === "NotAllowedError" ? "Camera permission was denied" : `Camera error: ${err.message}`, "error", 6000);
      close();
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    if (!camSelect.options.length) {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      camSelect.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${(c.label || `Camera ${i + 1}`).replace(/</g, "")}</option>`).join("");
      const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (active) camSelect.value = active;
      camSelect.classList.toggle("hidden", cams.length < 2);
    }
    if ("BarcodeDetector" in window) {
      const supported = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
      const detector = new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
      const loop = async () => {
        if (stopped || video.srcObject !== stream) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) found(codes[0].rawValue);
        } catch {
          /* frame not ready */
        }
        setTimeout(loop, 120);
      };
      loop();
    } else {
      try {
        const ZX = await loadZxing();
        // Hint 8 = ASSUME_GS1 in this ZXing build: keep GS1-128 separators instead of dropping them.
        const reader = new ZX.BrowserMultiFormatReader(new Map([[ZX.DecodeHintType?.ASSUME_GS1 ?? 8, true]]));
        zxControls = await reader.decodeFromVideoElement(video, (res) => {
          if (res && !stopped) found(res.getText());
        });
      } catch (err) {
        toast(err.message, "error");
      }
    }
  }
  camSelect.addEventListener("change", () => start(camSelect.value));
  start();
  return result;
}

/** A scan field: Enter submits; includes a camera button. */
export function scanField({ placeholder = "Scan barcode or type code / name", id = "scan-input" } = {}) {
  return html`
    <div class="search grow">
      ${icon("barcode", 20)}
      <input id="${id}" class="input scan-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${placeholder}" enterkeyhint="go" />
    </div>
    <button type="button" class="btn icon lg" data-camera title="Scan with camera" aria-label="Scan with camera">${icon("camera", 22)}</button>`;
}
