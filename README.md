# Folio

An independent, open-source, local-first design editor with editable layouts, real-time shaders, and a local MCP server for AI-assisted canvas editing.

**[Get started](#quick-start) · [User guide](docs/USAGE.md) · [Progress and roadmap](PARITY.md) · [Contribute](CONTRIBUTING.md)**

## About

Folio brings a Paper-inspired design workflow to an app you can run and inspect yourself. Create multi-page designs, edit shapes and text, arrange nested frames, apply animated shaders, and export your work without an app account. Your documents stay on your computer unless you explicitly export them or configure your own storage provider.

This is an independently implemented recreation, not Paper's original source code or a feature-complete clone. Folio is not affiliated with Paper and does not use its proprietary editor runtime or cloud backend. It integrates the open-source [Paper Shaders](https://shaders.paper.design/) library with its required attribution.

**Status:** early development, version `0.1.0`. The desktop app and browser preview work from source; installers, collaboration, and full Paper parity are not available yet. Windows is the verified desktop platform; macOS and Linux have not been validated.

## What you can do

- **Design across pages.** Create artboards, rectangles, ellipses, text, and embedded images. Rename, reorder, and delete pages with undo/redo and protection against deleting the last page.
- **Edit real geometry.** Select, drag, resize, rotate, duplicate, pan, and zoom. Nested single-line flex layouts support padding, gaps, alignment, stretching, and fixed/fit dimensions.
- **Style your artwork.** Use reusable color tokens, clipping, blend modes, shadows, filters, and a compact light/dark editor with Design and Theme panels.
- **Work with all 30 Paper Shaders.** Edit effect-specific controls, image filters, and logo animations using the genuine WebGL2 library, with an editable shader playground.
- **Save and export locally.** Autosave and reopen documents; exchange editable `.folio.json` files; export PNG, SVG, static HTML, offline animated HTML, or WebM video.
- **Connect local agents.** Opt into a loopback-only MCP server or its stdio adapter for document inspection, canvas edits, bounded HTML import, shaders, and exports.
- **Bring your own services.** Configure S3-compatible snapshot storage or an OpenAI-compatible image-generation endpoint in the desktop app. Neither is required to use the editor.

The [user guide](docs/USAGE.md) explains each workflow and its limits. The initial sample design is editable, original content.

## Quick start

Install **Node.js 22.12 or newer**, npm, and Git. The app has been tested on Windows with Node.js 25 and Electron 44.

```sh
git clone https://github.com/priyanshrv-netizen/Folio.git
cd Folio
npm ci
npm run desktop
```

`npm run desktop` builds the renderer and opens the Electron application. On Windows, after installing dependencies, you can also double-click **Launch Folio.cmd**. This runs from source; it is not an installer.

For the browser preview:

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. The browser uses IndexedDB and cannot host MCP or access desktop provider credentials. Browser and desktop documents are separate; use `.folio.json` export/import to move designs between them. Keep the development server on loopback.

## Current progress

The initial source import includes the working editor, desktop persistence and provider boundaries, the complete shader catalog, static and animated exports, local MCP integration, layout and appearance controls, and the page-management workflow.

The latest recorded feature-validation pass completed the production build, **879 serial Vitest tests across 29 files**, and **39 Playwright end-to-end tests**, including Electron and MCP workflows. These are recorded local results, not a claim of hosted CI or cross-platform certification. A parallel-only shader pixel-test mismatch remains documented.

The next areas of work include snapping and grouping, vector paths, richer typography, wrapping and responsive layout, additional export formats, large-file performance, and native distribution. See [PARITY.md](PARITY.md) for the checked-off milestones, verification evidence, and explicit non-goals.

The opening commits organize work that was developed locally before publication. They are an initial import, not a reconstructed or backdated development timeline.

## Development

| Command                      | Purpose                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                | Start the browser editor on loopback.                                 |
| `npm run desktop:dev`        | Start Vite and Electron together.                                     |
| `npm run build`              | Typecheck and build the production renderer.                          |
| `npm test -- --maxWorkers=1` | Run the unit, integration, and browser-backed Vitest suites serially. |
| `npm run test:e2e`           | Build and run the browser/Electron Playwright suite.                  |
| `npm run mcp -- --port 3100` | Run the stdio adapter for an already-enabled desktop MCP server.      |

The test suites require Google Chrome, WebGL2, and a desktop environment for Electron tests. Install Chrome before running them. Live cloud accounts and paid image generation are not required; provider tests use local fakes. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and contribution guidance.

### Source layout

| Path           | Contents                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| `src/`         | React editor, document model, canvas, pages, inspector, and local browser storage. |
| `src/shaders/` | Shader catalog, controls, image sources, and rendering lifecycle.                  |
| `src/exports/` | Static exports, offline shader runtime, and WebM recording.                        |
| `src/mcp/`     | Canvas command handling, compatibility layer, and bounded HTML import.             |
| `desktop/`     | Electron shell, sandbox/preload bridge, persistence, and provider clients.         |
| `desktop/mcp/` | Loopback MCP server, stdio adapter, schemas, and compatibility fixtures.           |
| `tests/`       | Browser and Electron end-to-end workflows.                                         |
| `licenses/`    | Retained Paper Shaders license and attribution.                                    |

## Privacy and security

The Electron renderer is sandboxed and context-isolated. Provider secrets are handled by the main process and encrypted with the operating system's credential protection; plaintext fallback is refused. Design files are local but **not encrypted backups**.

MCP starts disabled and listens only on `127.0.0.1`. While enabled, trusted local clients can inspect and modify the open document; it is not an authenticated remote service. Provider integrations send data only when you explicitly invoke those workflows and may incur provider charges.

Do not commit credentials, private designs, or local app data. The repository excludes dependency folders, build output, test artifacts, environment files, and exported Folio documents. Read the [security and data details](docs/USAGE.md#security-and-data) before enabling integrations.

## License and acknowledgments

Folio's independently authored application code is available under the [MIT License](LICENSE). Third-party packages retain their own licenses:

- [Paper Shaders](https://github.com/paper-design/shaders): Apache-2.0; [license](licenses/Paper-Shaders-LICENSE.txt) and [notice](licenses/Paper-Shaders-NOTICE.txt) included.
- [Inter](https://rsms.me/inter/): SIL Open Font License, bundled through `@fontsource/inter`.
- [Lucide](https://lucide.dev/): ISC license.
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk): MIT license.

Proprietary reference bundles and private account data are not distributed with Folio. For the implementation boundary and reference provenance, see [PARITY.md](PARITY.md).
