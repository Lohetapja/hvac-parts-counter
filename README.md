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

PDFs are never stored in localStorage or sent to a server. Construction drawings remain local to the browser.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

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
