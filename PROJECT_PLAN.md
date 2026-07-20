# HVAC Parts Counter - Development Plan

## Demonstration MVP - implemented

- Stable local PDF.js canvas workspace with fit, zoom, pan, render cancellation, page metadata, and a canvas pixel cap
- Preset/custom scale and guarded two-point calibration with dynamic route recalculation
- Centreline tracing with preview, keyboard completion/cancellation, point undo, snapping, selection, and metadata editing
- Manual fittings/devices with quantities, system, size, vertical length, notes, source, and verification state
- Conservative nearby-span PDF label suggestions with multiplier and compound-label support
- Grouped and detailed takeoff summaries, local save/restore safeguards, undo/redo, and CSV/JSON exports
- Three-workspace navigation: Drawing Takeoff, Custom Part Builder, and Material List
- Parametric rectangular transition geometry with shared Three.js and SVG projections
- Custom-part save/edit/duplicate/delete, version-3 storage migration, and export integration

## Next phase

- Validate against a representative suite of large AutoCAD-exported PDFs
- Add route point-drag editing only after interaction testing on dense drawings
- Improve label-line joining using more PDF font and orientation metadata
- Add configurable waste factors and drawing revision metadata
- Add automated unit tests for parsing, measurement grouping, persistence migration, and exports

## Explicit non-goals for this MVP

- OCR, computer vision, or automatic duct-vector recognition
- Fabrication-ready BOM claims
- Backend storage, accounts, cloud APIs, analytics, or collaboration
- Excel or annotated-PDF export
