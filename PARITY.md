# Paper-parity implementation track

The target is a familiar editor with independently written internals, no app account, user-owned storage, and bring-your-own image generation. This checklist records **implemented behavior**, not a claim that Paper's complete UI or 36-tool MCP catalog has been reproduced.

## Milestone 1 — an independent, usable local workflow

- [x] Electron app and browser development preview.
- [x] No app login or dependency on a running Paper process.
- [x] Left pages/layers panel, property inspector, canvas, and drawing dock.
- [x] Artboards, rectangle/ellipse shapes, text, and raster image imports.
- [x] Move/resize, multi-selection, pan/zoom, duplicate/delete, and undo/redo.
- [x] Local persistence, file picker, autosave status, and error feedback.
- [x] Validated editable JSON document import/export.
- [x] Whole-page PNG/SVG/HTML export.
- [x] User-owned S3/R2 snapshots and restore-as-copy.
- [x] Configurable OpenAI-compatible image endpoint/model/key.
- [x] Main-process encrypted credentials, isolated preload, and network error boundaries.

## Milestone 2 — editing parity

- [x] Reworked compact editor chrome with a vertical tool rail, searchable layers, hideable panels, and a shader library, compared visually with Paper’s publicly demonstrated editor layout.
- [x] All 30 effects in the open-source Paper Shaders 0.0.81 catalog: 20 effects, seven image filters, and three logo animations. Real GLSL, per-effect settings, embedded source-image uploads, and persistence.
- [x] Editable shader playground as a new file; explicit static SVG/PNG/HTML/JSX exports plus offline animated HTML and WebM video.
- [x] Compact 40-pixel header/tool rail, 240-pixel layer panel, 280-pixel inspector, denser layers, and collapsible Layout/Radius/Blending/Fill/Outline sections. Light and dark appearance persist locally.
- [x] Bundle-guided dark editor chrome: document/Dashboard tabs, Design/Theme switch, collapsible Pages, avatar/zoom/Share inspector header, and a minimal Page/MCP unselected state. Zoom presets preserve the canvas center; Share opens local export, not cloud collaboration.
- [x] Screen-space hover and selection outlines, immediate-child dashed bounds, size labels, and resize handles that stay readable through zoom; clipped and locked ancestry is respected by pointer interactions.
- [x] Inspect the signed-in installed Paper 0.5.15 editor at 1920×1080 / 125% Windows scaling, including page and artboard selection states, and align the primary panel dimensions and dark palette. This is not a pixel-equivalence claim across every state.
- [ ] Full menu/toolbar/panel inventory, including all states and shortcuts.
- [x] Persisted, nested, single-line flex layout: direction, alignment/stretch, distribution, gaps, and four-sided padding; geometry recomputed after edits and reflected in exports.
- [ ] Responsive sizing, wrapping, intrinsic fit, constraints, and full browser CSS layout.
- [ ] Smart snapping, alignment/distribution guides, grouping, and drag reparenting.
- [x] Frame clipping, fixed/fit-content flex dimensions, blend modes, outer/inner shadows, and blur/brightness/contrast/saturation controls with validated persistence and export rendering.
- [ ] Vector paths, pen editing, gradients, and additional advanced effects.
- [ ] Richer typography, font discovery, measured text layout, and font embedding in exports.
- [x] Editable document color tokens with linked fills, validated names/references, undo, and deletion that preserves the resolved fill; manual fill editing detaches the token.
- [ ] Other token types, reusable components, and arbitrary HTML/CSS/JSX import.
- [x] Page WebM video export and node-subtree exports through MCP.
- [ ] Selection/artboard export UI, PDF export, image cropping, and SVG import.
- [x] Page renaming, drag/menu reordering, and confirmed deletion, with undo/redo, active-page fallback, saved page order, and last-page protection.
- [ ] Larger-file performance and page-list virtualization.

## Milestone 3 — interoperability and distribution

- [x] Folio-owned, default-off local MCP endpoint and stdio adapter for inspection, editing, bounded HTML import, shaders, and export. Paper's MCP is not used as Folio's implementation or backend.
- [x] Compatibility fixtures captured through read-only Paper CLI initialization/tool discovery, and schema/workflow tests for supported Paper-shaped canvas operations. Original Folio call forms remain supported.
- [x] Client configuration for generic MCP clients, VS Code, and OpenCode; explicit capabilities and unsupported-operation reporting.
- [ ] Complete Paper API semantics, including cloud resources, comments, tokens, and cross-page operations.
- [ ] Google Drive connector and explicit OAuth authorization.
- [ ] Snapshot history, conflict detection, and safe multi-device synchronization.
- [ ] Native installers, update mechanism, crash recovery, and accessibility polish.
- [ ] Public release review of branding, visual assets, dependencies, and licensing.

## Known boundaries

- The current UI is an original implementation compared with the live Paper desktop editor and public references. Native window chrome, unimplemented panels, and some interactions differ; no byte-for-byte or all-state pixel-equivalence claim is made.
- The complete open-source shader catalog is integrated; this does not include every non-shader feature of Paper’s editor. WebGL2 is required. At most eight editor fills animate concurrently; additional fills show a marked still. Animated HTML preserves a live offline runtime and WebM captures motion. SVG/PNG/static HTML/JSX deliberately remain still snapshots. Editable Folio files retain parameters and source images.
- MCP accepts observed Paper-shaped inputs for supported canvas operations, with active-document/page scope. Compatibility is explicitly a tested subset, not a claim of complete drop-in equivalence. HTML import remains bounded and rejects unsupported constructs.
- Bucket operations are explicit snapshots, not collaborative real-time storage. Files bundle embedded assets for portability; large-asset deduplication is future work.
- Export typography depends on available fonts. HTML wraps text like the editor; SVG and PNG preserve explicit newlines but do not yet reproduce automatic soft wrapping. Exact cross-platform text metrics and font embedding need dedicated text-layout work.
- Frames can be free-positioned or use persisted flex layout with fixed dimensions or fit-to-contents dimensions. They can optionally clip children. Flex has no automatic wrapping/shrinking, percentage sizing, or intrinsic text measurement; removing it keeps the current computed positions and dimensions. Page canvas color is a persisted editor backdrop, not an extra painted artboard in image exports.
- There is no account system, team collaboration, comments, native Paper file importer, or Google Drive integration yet.
- Provider integrations require the user's real credentials for live validation. Local fake-provider tests do not prove those credentials or endpoint compatibility.

## Reference evidence

- Renderer reference fetched from `https://app.paper.design/assets/` on 2026-10-10: `main-CkqFojyn.js` (4,043,039 bytes), `main-D0mD97sb.css` (3,385 bytes), and `index-DtkxL5QJ.css` (267,046 bytes). The main stylesheet primarily covers canvas text/culling; the index stylesheet supplies the editor's theme, panels, controls, and toolbar. Both stylesheets and the JavaScript were inspected, rather than treating the main CSS as the complete UI.
- The bundle's panel state sets a 240-pixel default left panel, 280-pixel right panel, and 40-pixel tool rail. Its CSS establishes 28-pixel tree rows, 24-pixel controls and Design/Theme toggle, and 12-pixel base type. The implementation uses these CSS-pixel measurements; the provided Windows screenshot displays them at 125% scale. The installed screenshot's dark panel shade is retained where it differs from the newer web stylesheet.
- Reference assets are preserved outside the application in `.local-harness/work/paper-renderer/`, excluded from Git and from the app build. They are read-only reference material, not an executed Paper runtime, a login bypass, or a substitute for Folio's document model. The SHA-256 hashes are `9f54b8f57c1b043fd7f0ab5b74b6ab2242dd2fa28461dbd0d109bf3e157f7bea` (main JS), `fed42c9e48829bc863ed75f8c239151b3a10718792bd99863a18b9262821598c` (main CSS), and `5043f57080f9d171212657e2275c527ce6b42abfbfe1618f04edc8ec41c3fe97` (index CSS).
- Catalog: <https://shaders.paper.design/> and installed `@paper-design/shaders` 0.0.81 exports.
- Editor chrome: <https://paper.design/docs/mcp/barley-layout.png> and <https://paper.design/docs/mcp/mcp-callout-panel.png>. These public screenshots establish the visible layout, not unobserved interaction states.
- MCP: `desktop/mcp/fixtures/paper-cli-0.0.1.json`, captured via the installed Paper CLI’s read-only `initialize` and `tools/list` operations. No proprietary editor implementation was copied.
- The fresh web browser redirected to sign-in, but the already-installed desktop app had an authorized session. Its page and artboard selection states were inspected without editing the Paper document. Full-menu, all-state pixel equivalence remains outside the verified comparison.

## Verification of the renderer-guided pass

The production build and typecheck passed. The complete Vitest suite passed with `npm test -- --maxWorkers=1` (855 tests), and the complete Playwright suite passed (32 tests), including the desktop persistence/provider fixture, real local MCP client, shader exports, canvas interactions, and the new chrome/token workflows. Existing tests were not modified. Screenshots were inspected at 1536×824 CSS pixels with a 1.25 device scale factor to compare with the supplied Windows reference.

A parallel Vitest run produced one intermittent paused-shader video pixel mismatch. That unchanged test passed in isolation and in the complete serial run; the underlying parallel-only behavior was not established as fixed. The validated result is the serial suite, not a claim that every parallel GPU run is deterministic.

## Verification of the page-management continuation

The production build and typecheck passed after adding page management. The complete serial Vitest suite passed with **879 tests across 29 files**, and the complete Playwright suite passed with **39 tests**, including the desktop and MCP workflows. This pass adds 23 model cases, one real disk-persistence case, and seven browser workflows without changing any existing tests.

Coverage includes invalid and unchanged names, stale IDs, page-limit enforcement, immutable history snapshots, drag/menu ordering, deletion of active and inactive pages, last-page protection, keyboard focus and shortcut isolation, undo/redo, reopening, and editable export. The dark and light page menus and rename/delete dialogs were rendered and inspected at 1536×824 CSS pixels with 1.25 device scaling; a narrow 960-pixel viewport also verifies long-name truncation. This pass does not resolve the previously recorded parallel shader-test limitation or the remaining larger-file performance work.

## Initial public-source preparation

The publication candidate was checked again on 2026-10-10 with `npm run build`, `npm test -- --maxWorkers=1`, and `npm run test:e2e`. The build and typecheck succeeded, all **879 Vitest tests across 29 files** passed, and all **39 Playwright tests** passed on Windows with Node.js 25.9.0. Provider tests used local fakes; no live cloud-account verification was added.

Non-failing warnings remain: the production build reports a large JavaScript chunk and a shader module that is both statically and dynamically imported; an MCP browser-test fixture reports a dependency-prebundling warning for `virtual:folio-export-runtime`. The affected tests passed. This verification does not claim that those warnings or the previously recorded parallel shader-test limitation were fixed.

The initial history organizes the pre-existing local implementation into application source, regression tests, and public documentation. These are present-day import commits, not a backdated development timeline. The repository excludes proprietary reference bundles, dependencies, generated output, environment files, and local design data. Publication preparation includes a credential-pattern scan with review of the three intentionally invalid dummy-credential example URLs in provider/security tests; it is not a full security or legal audit.
