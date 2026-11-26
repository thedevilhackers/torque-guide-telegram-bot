# The Tuning Book

A 40-page A5 customer booklet that explains Stage 1 to Stage 3 tuning. It covers every part, why it's fitted, how it's installed, how it's tuned and how each tune is checked. It ends with the franchise offer.

| File | Use it for |
| --- | --- |
| `Unity-Performance-Tuning-Book.pdf` | WhatsApp, email and the website. A5, 2 MB. |
| `Unity-Performance-Tuning-Book-print-3mm-bleed.pdf` | The printer. A5 with 3 mm bleed on every side (154 × 216 mm). |

## What's inside

| Pages | Section |
| --- | --- |
| 1 | Cover: logo, QR code to the website, WhatsApp, address, opening hours and Instagram |
| 2 | Contents |
| 3–7 | **The basics:** how an engine makes power, inside the ECU, what a tune changes, why tuning is the most popular upgrade, and the three stages compared |
| 8–10 | **Stage 1:** what changes in the software, and the 10-step process |
| 11–16 | **Stage 2:** intercooler, intake and boost pipes, downpipe with high-flow catalyst, spark plugs and gearbox tuning, and diesel Stage 2. Each part has an exploded-view diagram. |
| 17–22 | **Stage 3:** the turbo (exploded), hybrid vs bigger turbo, fuel system, clutch and flywheel, and cooling and supporting parts |
| 23–27 | **Installation:** a car cutaway showing where every part sits, then step-by-step installation diagrams for the intercooler, intake, turbo, spark plugs, downpipe, fuel pump and injectors, and clutch |
| 28–31 | **Our work:** ethanol tuning, how tunes are monitored, the health check and safety limits, and power figures for 14 popular cars |
| 32–36 | **After your tune:** car care, what we will and won't do, FAQ, glossary, and a tune-record page to fill in at handover |
| 37–39 | **Franchise:** the offer, the Standard and Premium packages and terms, and how to apply, with a QR code to unityperformance.co/franchise |
| 40 | Back cover: QR codes for WhatsApp, the website and Instagram, plus contact details |

## Printing

- **Size:** A5 portrait, 40 pages, saddle-stitched (stapled).
- **Paper:** 300 gsm matt cover with matt lamination; 130–170 gsm matt art paper inside.
- **Colour:** full colour on both sides.
- **Proof first:** ask for one printed proof before the full run, and scan all five QR codes on it.

## Check before printing

- **Process pages (10, 29 and 30)** describe how the workshop works. Make sure every step matches what you actually do.
- **Installation times (pages 24–27)** are typical times for common cars. Adjust them if yours differ.
- **Power figures (pages 7 and 31)** come from the model list on the website. Update both together if the model list changes.
- **Franchise prices and terms (pages 37–39)** come from the franchise page on the website. Update them here too if they change in Admin.
- **Illustrations** are drawings, not photos. To use photos of real parts from the workshop instead, they can be swapped in.

## Editing and rebuilding

The source is in `source/`:

- `src/booklet.html`: the page content.
- `src/booklet.css`: the design.
- `src/illus.js`: the exploded views and charts.
- `src/install.js`: the installation diagrams.

The contents list, page numbers and cross-references ("How it's fitted: page 24") update automatically.

To rebuild (needs Node.js and Playwright):

```
node source/render.cjs pdf Unity-Performance-Tuning-Book.pdf
node source/render.cjs pdf Unity-Performance-Tuning-Book-print-3mm-bleed.pdf print
node source/render.cjs review <folder>     # one PNG per page, and a warning if any page overflows
```

## Fonts

All under the SIL Open Font License (`source/src/fonts/OFL.txt`):

- Barlow, Barlow Condensed and Anton.
- Noto Sans Devanagari, used only for the ₹ sign, which the other fonts don't have.
