# HVAC Parts Counter

A local-first, browser-based assisted HVAC takeoff tool built with Vite, strict TypeScript, PDF.js, canvas, and browser storage.

## Current MVP

- Load local PDFs without uploading them
- Fit, zoom, Ctrl-wheel zoom, drag-pan, and select PDF pages
- Use scale presets or a custom drawing scale
- Calibrate from two points and a known real dimension
- Trace centreline routes with live preview and optional 45-degree snapping
- Select routes and edit shape, size, system, and notes
- Add common HVAC fittings and devices through a compact form
- Scan page text for conservative KSO, KTS, ROX, OLO, FLO, VIVA, RISD, and IMUKARTIO suggestions
- Review, edit, accept, reject, and later edit detected items
- View grouped and detailed live takeoff totals
- Undo/redo route and part creation/deletion
- Automatically save project data locally and restore it after refresh
- Export grouped CSV, detailed CSV, and complete project JSON
- Build rectangular-to-rectangular transitions from millimetre dimensions
- Preview custom transitions interactively in Three.js and as front, top, and side SVG drawings
- Save, reopen, duplicate, group, restore, and export parametric custom parts

## Custom Part Builder

Use the major workspace navigation to open **Custom Part Builder**. The first generator supports centred, offset, same-size, reducing, and enlarging rectangular transitions. End A is centred at `Z = 0`; End B is at the entered length and moves by signed X/Y offsets. The builder stores parameters only—never screenshots or WebGL data.

The generated values, edge lengths, centreline, and surface area are geometric estimates for takeoff and communication. They are not fabrication-ready developments and do not include seams, flanges, allowances, or bend deductions.

PDFs are never stored in localStorage or sent to a server. Construction drawings remain local to the browser.

## Run locally

```bash
npm install
npm run dev
```

## Production validation

```bash
npm run build
npm run preview
```

The production preview is served beneath the same project path used by GitHub Pages:

`http://127.0.0.1:4173/hvac-parts-counter/`

## Deploy to GitHub Pages

The repository is configured to deploy `dist/` with the official GitHub Pages Actions workflow whenever `main` is pushed.

1. Push the `main` branch to `https://github.com/Lohetapja/hvac-parts-counter`.
2. In the repository, open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Monitor the **Deploy HVAC Parts Counter** workflow.

Expected site: https://lohetapja.github.io/hvac-parts-counter/

Uploaded drawings stay in the browser and are never included in local project storage. Real PDFs must not be committed; the repository ignores all `*.pdf` files and `public/test-drawings/`.

## Demo workflow

1. Upload an HVAC PDF.
2. Select `1:50` and calibrate against a known `3000 mm` line.
3. Trace and finish two duct routes with different sizes.
4. Add a 90-degree bend and tee.
5. Scan the current PDF page and review detected label suggestions.
6. Edit and accept one multiplied suggestion.
7. Review grouped totals, save locally, refresh, and restore the PDF.
8. Export summary CSV, detailed CSV, and JSON.

## Scope

This is an assisted measurement and counting MVP, not automatic vector recognition, OCR, or a fabrication-ready BOM. Human review remains required.
