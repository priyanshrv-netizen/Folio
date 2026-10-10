# Folio user guide

An independent, local-first design editor with genuine open-source Paper shaders and a local MCP server. No login, no Paper backend, no bundled service keys. The editor uses its own implementation; it is not a feature-complete or pixel-exact Paper clone.

## Run

Requires Node.js 22.12+ and npm. Tested on Windows using Node.js 25 and Electron 44.

```sh
git clone https://github.com/priyanshrv-netizen/Folio.git
cd Folio
npm ci
npm run desktop
```

For renderer development, `npm run dev` serves a browser preview at `http://127.0.0.1:5173`. The browser preview stores files in IndexedDB and intentionally cannot store provider secrets or call cloud/image providers. `npm run desktop:dev` starts Vite and the Electron app together; stop any existing Vite instance first.

`npm run desktop` builds and launches from source. A distributable installer is not included yet.

On Windows, after running `npm ci`, double-click **Launch Folio.cmd** to build and open the app without typing the commands.

## What works

- A multi-page canvas with artboards, rectangles, ellipses, text, and embedded raster images.
- Page renaming, drag/menu reordering, and confirmed deletion, with undo/redo and saved page order.
- Selection, shift-selection, marquee selection, drag, corner resize, rotation, pan, and zoom.
- A compact, dark-by-default editor with Dashboard/document tabs, Design/Theme panels, a vertical tool rail, header zoom, and a collapsible inspector. Existing light/dark preferences are preserved.
- Screen-space block hover and selection outlines, dashed child bounds, size labels, and handles that stay legible when zooming. Double-click text to edit it; clipped and locked descendants do not steal pointer interactions.
- Persisted frame flex layout: row/column flow, gaps, four-sided padding, nine-point alignment, stretch, spacing, and fixed/fit dimensions. Resizing a frame or editing a child recalculates the geometry used by the canvas and exports.
- Real clipping, blend modes, outer/inner shadows, and blur/brightness/contrast/saturation controls, with undo and validated document persistence.
- Document color tokens in **Theme**, plus an editable Page canvas backdrop. Token edits update linked fills; manual fill edits detach them without changing other linked layers.
- Undo/redo, subtree duplication/deletion, visibility/locking controls, and stacking order.
- Local autosave, reopening files, and editable `.folio.json` import/export.
- Whole-page PNG, SVG, script-free static HTML, self-contained animated HTML, and WebM motion exports.
- Desktop settings for your own S3-compatible storage and OpenAI-compatible image endpoint.
- Explicit cloud snapshot upload and restore-as-copy, rather than background synchronization.
- A compact vertical tool rail, searchable layers, hideable panels, a shader browser, and an editable shader playground.
- Light/dark editor appearance through **File menu**, remembered on the device without changing artwork colors.
- The complete 30-effect open-source Paper Shaders catalog, including image filters and logo animations, with embedded source images and effect-specific controls.
- A default-off local MCP endpoint for agents to inspect and modify the open canvas, import supported HTML, use shaders, and export artwork.

The initial sample document is original editable content, not a screenshot or imported Paper source.

## Paper shaders

Click **Shader library**, the wave icon in the tool rail. Choose an effect to apply it to selected unlocked shapes/artboards, or click its **+** to insert a new layer. The inspector’s **Fill → Shader** controls edit the colors, scale, speed, and effect detail. **Open shader playground**, the palette icon in the rail or the File menu command, creates a separate editable example file without overwriting your current document.

The library opens with six featured effects; choose **Collection → All effects** for all 30. Search always searches the complete catalog, even when a collection is selected.

- **Effects (20):** Mesh gradient, Static mesh gradient, Static radial gradient, Grain gradient, Dithering, Dot orbit, Dot grid, Warp, Spiral, Swirl, Waves, Neuro noise, Perlin noise, Simplex noise, Voronoi, Pulsing border, Metaballs, Color panels, Smoke ring, and God rays.
- **Image filters (7):** Paper texture, Fluted glass, Water, Image dithering, Halftone dots, Halftone CMYK, and Lens distortion.
- **Logo animations (3):** Heatmap, Liquid metal, and Gem smoke.

These run the actual `@paper-design/shaders` 0.0.81 WebGL2 shaders, not approximations. Open **Effect settings** for each shader’s additional parameters. Image filters and logo shaders expose **Shader source image**: PNG/JPEG/GIF/WebP uploads are validated, resized to at most 1536 pixels, and embedded in the document. Built-in sources are generated locally; there are no external image requests. Static patterns are labeled as static. System reduced-motion preferences pause animation. Up to eight editor fills animate at once; additional fills render as clearly marked stills. Individual shader rendering is bounded to 2048 pixels per dimension and about two million pixels. WebGL2 failures are shown on the affected fill.

`.folio.json` preserves editable parameters and embedded images. **Animated HTML** bundles the shader runtime into an offline web page; **WebM video** records a motion clip. PNG, SVG, **HTML + CSS**, and MCP JSX retain their explicitly static snapshot behavior. Standard PNG/SVG are not video containers. The animated export option is selected by default when a page contains shaders.

Animated exports support at most eight visible shader fills and an 8.4-million shader-pixel budget; larger pages must be split or exported as stills. WebM supports 1–15 seconds at a target 12, 24, or 30 fps, downscales to at most 1920 pixels / 2.07 megapixels, composites transparent artwork over white, and can be cancelled without changing the design. Keep the app visible while recording. Encoding and achieved frame rate depend on the device; no audio track is created. Animated HTML embeds Inter’s Latin 400/500/600/700 font files and the required licenses; other scripts and fonts depend on what the viewing device provides.

## Organize pages

In **Design → Pages**, use a page's **…** menu to rename it, move it up or down, or delete it. Double-click a page name or focus it and press **F2** to rename; drag a page above or below another to reorder it. Arrow keys, Home, and End move keyboard focus through the page list, and Enter opens the focused page. Page-menu keys never nudge selected artwork.

Deleting a page asks for confirmation and removes its complete layer tree in one undoable edit. If it was the active page, the next page opens, or the previous one when deleting the final item. The last remaining page cannot be deleted. Names, order, artwork, and page colors survive autosave, reopening, and editable JSON export. Undo history lasts only while the file stays open. New pages use an available default name, and **Add page** is disabled at the existing 100-page document limit.

## Frame layout

Select an artboard/frame and click **Layout → Flex +**. Choose horizontal or vertical flow, then set gap, alignment, distribution, and individual padding values. Direct children follow their layer order, and hidden children do not occupy space. Layout changes, resizing, and child edits are undoable and persist when reopened. Nested frames are laid out after their parents so cross-axis stretching reaches their children. Removing flex keeps the current geometry.

This is single-line layout with no automatic shrinking, wrapping, percentage sizing, or intrinsic text measurement. With flex enabled, **Width sizing** and **Height sizing** can fit the children's dimensions, padding, and gaps. Children can overflow a frame unless **Clip content** is checked. Removing flex preserves the computed dimensions and switches fitted dimensions back to fixed. Unsupported CSS layout requests are rejected rather than silently accepted.

## Theme and editor controls

Use **Theme → Create token** to define a named opaque hex color, then apply it to selected layers with the token's apply button. Editing the token updates its linked layers. Deleting it preserves their current resolved color, and typing a manual Fill value detaches that layer. Tokens and their links survive undo, reopening, and editable JSON export.

With nothing selected, **Page** changes the canvas backdrop; it does not add a background layer to artwork exports. The header zoom menu preserves the center of the view when choosing a percentage. **Share** opens the existing local export dialog. The avatar represents this local workspace, not a simulated account or collaborators.

The layout and controls were compared with the actual `main-CkqFojyn.js`, `main-D0mD97sb.css`, and `index-DtkxL5QJ.css` served by `app.paper.design`, as well as desktop screenshots. Asset hashes and observed sizing are recorded in [PARITY.md](../PARITY.md). These files are reference material outside the distributed app; Folio still runs its own editor and does not claim byte-for-byte frontend or backend equivalence.

## Connect an agent through MCP

In the desktop app, click **Connect agents → Enable MCP**. The dialog shows the live endpoint and copyable client configuration. The default port is 3100; choose another free port if it is occupied. Add the server to an MCP client running on the **same computer**:

```json
{
  "mcpServers": {
    "folio": { "url": "http://127.0.0.1:3100/mcp" }
  }
}
```

This is a Streamable HTTP server using the official MCP SDK. It starts disabled, resets to disabled after restart, and listens only on IPv4 loopback. Browser-origin requests and unexpected Host headers are rejected. **Any local process can read and modify the open document while enabled**; enable it only when you trust your local clients. No provider keys, settings, arbitrary filesystem paths, shell commands, or runtime evaluation are exposed. Browser preview cannot host this server. A remote agent cannot reach your loopback endpoint.

The dialog also offers a **stdio** adapter and configuration formats for VS Code and OpenCode. It supplies the absolute installed script path; Node.js must be available to the client. For terminal clients, `npm run mcp -- --port 3100` starts the adapter, but use the dialog’s direct `node` command in MCP configuration to keep stdout protocol-only. Tool discovery works while Folio is closed; document operations require the desktop app open with MCP enabled. The adapter never enables the server, launches Paper, or accesses provider settings.

Implemented tools include:

- **Inspect:** `get_basic_info`, `get_selection`, `get_node_info`, `get_children`, `get_tree_summary`, `find_nodes`, `get_computed_styles`.
- **Edit:** `create_artboard`, `create_nodes`, `update_styles`, `set_text_content`, `rename_nodes`, `duplicate_nodes`, `delete_nodes`, `move_nodes`, `create_page`, `rename_pages`, `write_html`.
- **Shaders:** `list_shader_presets`, `apply_shader`.
- **Export:** `get_jsx`, `export`, `get_screenshot`.
- **Compatibility helpers:** `get_fill_image`, `get_font_family_info`, `get_guide`, `get_capabilities`. Follow `tools/list` pagination to discover these helpers.

Tools operate on the open document and active page. Read `get_basic_info`, then pass its `documentId` and `pageId` as guards when editing. A mutation validates the entire result before one undoable editor transaction, appears live, and reports whether saving succeeded. File/page switches cancel stale requests. `create_page` adds a page without changing the human’s view. Screenshots rasterize isolated artwork, never the application window or settings dialogs.

Paper-shaped inputs are tested against a captured, read-only `tools/list` response from the installed Paper CLI (server version 0.0.1, 36 advertised schemas). Supported contracts include `fileId`, `get_children(nodeId)`, `create_artboard(styles)`, CSS `update_styles`, `textContent`, `duplicate_nodes(nodes)`, relative/indexed `move_nodes`, `write_html(targetNodeId, mode)`, and JSX format selection. Folio’s earlier calls remain accepted. `get_capabilities` states the supported subset and limits. Paper advertises no output schema, so these checks do not establish exact response equivalence.

`write_html` creates editable nodes from bounded block/flex containers and text with inline styles, not executable HTML. Scripts, remote URLs, external resources, arbitrary CSS, percentages, and unsupported constructs fail atomically. Text metrics are estimated. `list_shader_presets` preserves the original six presets for older clients; pass `{ "catalog": "all" }` to discover all 30 editable configurations. `export` accepts `format: "animated-html"` for the live offline runtime. These contracts do **not** reproduce Paper’s cloud files, comments, tokens, team services, generation URLs, or arbitrary browser HTML/CSS.

## Your bucket

In **Settings → Storage**, select **Amazon S3 / Cloudflare R2** and enter your bucket, region, prefix, and credentials. Leave the endpoint blank for AWS. For R2, enter your account's S3 endpoint and use `auto` as the region. Restrict credentials to the bucket and prefix you want Folio to use.

Choose **File menu → Back up to cloud** to upload the current document. **Your files → Your bucket** lists snapshots. Opening a cloud snapshot creates a new local document, so it does not overwrite your working copy. Repeated backups of the same file replace that remote snapshot. There is no background sync, conflict merging, team access control, or built-in version history in this milestone; enable bucket versioning separately if you need it.

No live AWS/R2 account is included. Provider behavior is covered by local mocked tests, not evidence of access to your bucket. Google Drive is not implemented.

## Your image provider

In **Settings → Image generation**, enter a complete generation endpoint, model, and API key. The protocol is OpenAI-compatible: a JSON POST containing `model`, `prompt`, and `n: 1`, with a response containing `data[0].b64_json` or `data[0].url`. Providers requiring other request schemas need an adapter. HTTPS is required except for loopback development providers.

Choose the sparkle tool, enter a prompt, and click **Generate image**. That action sends the prompt to your configured provider and may incur provider charges. The result is imported as an embedded raster image; Folio does not use Paper's generation API. No paid/live generation is run by tests.

## Security and data

- The Electron renderer is sandboxed and context-isolated, with Node integration disabled and a narrow preload bridge.
- Documents contain only validated design fields and embedded PNG/JPEG/WebP/GIF data. Script markup, arbitrary remote image URLs, file paths, and provider credentials are not document data.
- Provider keys stay in the main process and are encrypted using Electron `safeStorage` backed by the OS. Plaintext fallback is refused. Settings responses expose presence flags, never keys.
- Application data and designs are local files. They are **not encrypted design backups**; normal device permissions and backups still matter.
- Browser and desktop storage are separate. Use `.folio.json` export/import to move between them.
- Images are limited to 10 MiB each and 20 MiB decoded in aggregate; documents to 32 MiB, 100 pages, and 10,000 total nodes. This is a small-document editor, not yet optimized for very large projects.

Do not commit keys or local design data. Do not expose the development server to untrusted networks.

## Verification

```sh
npm run build
npm test -- --maxWorkers=1
npm run test:e2e
```

Browser-backed unit tests and end-to-end tests use the installed Chrome channel. They cover drawing, property editing, resize, undo/redo, saving/reloading, page switching, importing/exporting, rejected malformed documents, and browser-only provider restrictions. Desktop provider tests use temporary directories and fake credentials only. Serial Vitest execution avoids a previously observed parallel-only shader pixel mismatch; see [the verification notes](../PARITY.md#verification-of-the-renderer-guided-pass).

The Electron end-to-end test also verifies the actual sandbox/preload boundary, on-disk persistence across app restarts, OS-encrypted credential storage, and a complete image-generation request against a local fake provider. End-to-end testing rebuilds the app first so it exercises the current production bundle.

Studio tests exercise all six shaders, changing animation pixels, pause/reduced-motion behavior, palette editing, undo/redo, saved reopening, snapshot exports, and the browser/desktop MCP boundary. A separate Electron test connects the real MCP SDK client to the desktop app, creates and edits artwork, applies a shader, imports HTML, captures/export artwork, verifies browser-origin rejection, disables the server, and reopens the saved work after restart.

Catalog tests additionally render all 30 effects through real WebGL2, check animation/static behavior, image/logo processing, effect parameters, source replacement, and resource disposal. Compatibility tests cover observed Paper inputs and the real stdio transport. Layout tests verify recursive reflow, validation, duplication, persistence, and export geometry. Animated export tests exercise downloaded offline HTML and video rather than merely checking generated source strings.

## Scope and licensing

Folio’s application code is independently authored and MIT licensed. Inter is bundled through `@fontsource/inter` under its SIL Open Font License, and Lucide icons are used under their ISC license. The genuine Paper shader library is Apache-2.0 licensed; its license and required attribution are retained in `licenses/` and the shader browser. The MCP SDK is MIT licensed. Third-party packages retain their own licenses. No extracted proprietary Paper editor source, proprietary icons, remote editor bundle, or account credentials are part of the project. Folio is not affiliated with Paper.

See [PARITY.md](../PARITY.md) for the implementation boundary and remaining work, and [CONTRIBUTING.md](../CONTRIBUTING.md) for the development workflow. Native installers are not included; run the application from source.
