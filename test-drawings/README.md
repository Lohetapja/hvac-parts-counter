# Local regression corpus (not committed)

Place the developer's real one-page HVAC test drawings here. The PDF files are
**gitignored** (`test-drawings/` is ignored except this README) and must never be
committed, pushed, or uploaded anywhere — all PDF processing stays local in the
browser.

Expected files for the scan regression corpus:

- `G3-01 1.Krs.pdf`
- `G3-03 3.Krs.pdf`
- `G3-04 4.Krs.pdf`
- `G3-05 5.Krs.pdf`
- `IV 1 F (1)(1).pdf`

## How to run the corpus

1. `npm run dev`
2. Open the app, click **Upload PDF**, pick a file from this folder.
3. Confirm the title block populates in the left Project panel.
4. Click **Scan drawing** (right panel) and watch scan progress.
5. Use **Highlight Tulo** / **Highlight Poisto** and inspect the detected parts.
6. Use **Scan diagnostics (dev)** in the scan panel to download a JSON report with
   detected labels, geometry counts, network/part candidates, unresolved reasons,
   and scan timing.

Record per file: loads, title block detected, labels indexed, geometry indexed,
scan completes, Tulo/Poisto candidates found, no freeze, no uncaught errors.
