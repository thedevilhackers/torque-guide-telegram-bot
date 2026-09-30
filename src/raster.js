import { deflateSync } from "node:zlib";
import { GLYPH_HEIGHT, GLYPH_WIDTH, fontText, glyph } from "./pixel-font.js";

// A small dependency-free raster canvas. Shapes are drawn on a supersampled
// grid and averaged down in toPng(), which gives anti-aliased edges.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

export function hex(color, alpha = 1) {
  const value = color.replace("#", "");
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).concat(alpha);
}

export function dashSegments(points, [on, off]) {
  const segments = [];
  let current = [points[0]];
  let drawing = true;
  let remaining = on;
  for (let i = 1; i < points.length; i++) {
    let [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    let length = Math.hypot(x1 - x0, y1 - y0);
    while (length > 1e-9) {
      const step = Math.min(remaining, length);
      const t = step / length;
      x0 += (x1 - x0) * t;
      y0 += (y1 - y0) * t;
      length -= step;
      remaining -= step;
      if (drawing) current.push([x0, y0]);
      if (remaining <= 1e-9) {
        if (drawing && current.length > 1) segments.push(current);
        drawing = !drawing;
        remaining = drawing ? on : off;
        current = [[x0, y0]];
      }
    }
  }
  if (drawing && current.length > 1) segments.push(current);
  return segments;
}

export class Canvas {
  constructor(width, height, background, supersample = 3) {
    this.width = width;
    this.height = height;
    this.ss = supersample;
    this.w = width * supersample;
    this.h = height * supersample;
    this.data = new Uint8ClampedArray(this.w * this.h * 3);
    this.fillRect(0, 0, width, height, background);
  }

  span(y, x0, x1, [r, g, b, a = 1]) {
    if (y < 0 || y >= this.h) return;
    const start = Math.max(0, x0);
    const end = Math.min(this.w, x1);
    const d = this.data;
    for (let x = start, i = (y * this.w + start) * 3; x < end; x++, i += 3) {
      if (a >= 1) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      } else {
        d[i] += (r - d[i]) * a;
        d[i + 1] += (g - d[i + 1]) * a;
        d[i + 2] += (b - d[i + 2]) * a;
      }
    }
  }

  fillRect(x, y, width, height, color) {
    const s = this.ss;
    const x0 = Math.round(x * s);
    const x1 = Math.round((x + width) * s);
    for (let row = Math.round(y * s), end = Math.round((y + height) * s); row < end; row++) this.span(row, x0, x1, color);
  }

  // Even-odd scanline fill, sampled at supersampled pixel centres.
  fillPolygon(points, color) {
    const s = this.ss;
    const scaled = points.map(([x, y]) => [x * s, y * s]);
    const ys = scaled.map(([, y]) => y);
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const bottom = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    const crossings = [];
    for (let row = top; row <= bottom; row++) {
      const cy = row + 0.5;
      crossings.length = 0;
      for (let i = 0, j = scaled.length - 1; i < scaled.length; j = i++) {
        const [xi, yi] = scaled[i];
        const [xj, yj] = scaled[j];
        if (yi > cy !== yj > cy) crossings.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) this.span(row, Math.round(crossings[k]), Math.round(crossings[k + 1]), color);
    }
  }

  fillCircle(cx, cy, radius, color) {
    const s = this.ss;
    const x = cx * s;
    const y = cy * s;
    const r = radius * s;
    for (let row = Math.floor(y - r); row <= Math.ceil(y + r); row++) {
      const dy = row + 0.5 - y;
      if (Math.abs(dy) > r) continue;
      const half = Math.sqrt(r * r - dy * dy);
      this.span(row, Math.round(x - half), Math.round(x + half), color);
    }
  }

  line(x0, y0, x1, y1, width, color) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (!length) return;
    const nx = (-(y1 - y0) / length) * (width / 2);
    const ny = ((x1 - x0) / length) * (width / 2);
    this.fillPolygon([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], color);
  }

  // Use opaque colours for strokes: joints overlap, so translucent strokes would double-blend.
  polyline(points, width, color, dash) {
    for (const segment of dash ? dashSegments(points, dash) : [points]) {
      for (let i = 1; i < segment.length; i++) this.line(...segment[i - 1], ...segment[i], width, color);
      for (const [x, y] of segment) this.fillCircle(x, y, width / 2, color);
    }
  }

  measureText(text, size) {
    const length = fontText(text).length;
    return length ? (length * (GLYPH_WIDTH + 1) - 1) * size : 0;
  }

  // Draws text with its top edge at y. size is the on-screen size of one font dot.
  text(value, x, y, size, color, align = "left") {
    const text = fontText(value);
    const width = this.measureText(text, size);
    let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    for (const char of text) {
      const rows = glyph(char);
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        for (let col = 0; col < GLYPH_WIDTH; col++) {
          if (rows[row][col] === "#") this.fillRect(cursor + col * size, y + row * size, size, size, color);
        }
      }
      cursor += (GLYPH_WIDTH + 1) * size;
    }
    return width;
  }

  toPng() {
    const { width, height, ss, w, data } = this;
    const area = ss * ss;
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < ss; dy++) {
          for (let dx = 0, i = ((y * ss + dy) * w + x * ss) * 3; dx < ss; dx++, i += 3) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
          }
        }
        const o = (y * width + x) * 3;
        rgb[o] = Math.round(r / area);
        rgb[o + 1] = Math.round(g / area);
        rgb[o + 2] = Math.round(b / area);
      }
    }
    return encodePng(width, height, rgb);
  }
}
