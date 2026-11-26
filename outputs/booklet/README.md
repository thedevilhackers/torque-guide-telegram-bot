# The Tuning Book

A 32-page A5 customer booklet that explains Stage 1 to Stage 3 tuning: every part, why it's fitted, how it's tuned and how each tune is checked.

| File | Use it for |
| --- | --- |
| `Unity-Performance-Tuning-Book.pdf` | WhatsApp, email and the website. A5, 1.6 MB. |
| `Unity-Performance-Tuning-Book-print-3mm-bleed.pdf` | The printer. A5 with 3 mm bleed on every side (154 × 216 mm). |

## What's inside

1. Cover: logo, QR code to the website, WhatsApp, address, opening hours and Instagram.
2. Contents.
3. **The basics** (pages 3–7): how an engine makes power, inside the ECU, what a tune changes, why tuning is the most popular upgrade, and the three stages compared.
4. **Stage 1** (pages 8–10): what changes in the software, and the 10-step process.
5. **Stage 2** (pages 11–16): intercooler, intake and boost pipes, downpipe with high-flow catalyst, spark plugs, gearbox tuning, and diesel Stage 2.
6. **Stage 3** (pages 17–22): the turbo, hybrid vs bigger turbo, fuel system, clutch and flywheel, and cooling and supporting parts.
7. **Our work** (pages 23–26): ethanol tuning, how tunes are monitored, the health check and safety limits, and power figures for 14 popular cars.
8. **After your tune** (pages 27–31): car care, what we will and won't do, FAQ, glossary, and a tune-record page you fill in at handover.
9. Back cover: QR codes for WhatsApp, the website and Instagram, plus contact details.

## Printing

- **Size:** A5 portrait, 32 pages, saddle-stitched (stapled).
- **Paper:** 300 gsm matt cover with matt lamination; 130–170 gsm matt art paper inside.
- **Colour:** full colour on both sides.
- **Proof first:** ask for one printed proof before the full run, and scan all four QR codes on it.

## Check before printing

- **Process pages (10, 24 and 25)** describe how the workshop works. Make sure every step matches what you actually do.
- **Power figures (pages 7 and 26)** come from the model list on the website. Update both together if the model list changes.
- **Illustrations** are drawings of each part, not photos. To use photos of real parts from the workshop instead, they can be swapped in.

## Editing and rebuilding

The source is in `source/`:

- `src/booklet.html`: the page content.
- `src/booklet.css`: the design.
- `src/illus.js`: the drawings and charts.

The contents list, page numbers and cross-references update automatically.

To rebuild (needs Node.js and Playwright):

```
node source/render.cjs pdf Unity-Performance-Tuning-Book.pdf
node source/render.cjs pdf Unity-Performance-Tuning-Book-print-3mm-bleed.pdf print
node source/render.cjs review <folder>     # one PNG per page, and a warning if any page overflows
```

Fonts: Barlow, Barlow Condensed and Anton, under the SIL Open Font License (`source/src/fonts/OFL.txt`).
