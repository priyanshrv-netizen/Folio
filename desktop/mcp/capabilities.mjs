export const MCP_API_VERSION = '0.2.0';
export const MCP_INSTRUCTIONS =
  'Folio local canvas tools. Read get_basic_info first. Follow tools/list nextCursor for additional helpers. Paper-shaped inputs are supported for the documented subset; this is not a Paper drop-in API. Only the active document and page are accessible: fileId aliases documentId, and pageId is a stale-page guard, not a page switch. One mutation call is one validated undoable transaction. No settings, credentials, arbitrary files, network fetches, or user code execution. Unsupported HTML/CSS fails atomically. get_capabilities and get_guide describe exact limits. Folio must be open and MCP explicitly enabled in Connect agents; the stdio adapter never enables it.';

export function mcpCapabilities() {
  return {
    implementation: 'folio-local',
    apiVersion: MCP_API_VERSION,
    transports: ['streamable-http', 'stdio-proxy'],
    paper: {
      source: 'Installed Paper CLI MCP initialize and tools/list, observed 2026-10-10',
      serverVersion: '0.0.1',
      schemaCount: 36,
      outputSchemaAvailable: false,
      contracts: [
        'fileId',
        'get_children.nodeId',
        'create_artboard.styles',
        'update_styles.CSSProperties',
        'set_text_content.textContent',
        'duplicate_nodes.nodes',
        'move_nodes.before-after-index',
        'write_html.targetNodeId-mode',
        'get_jsx.format',
        'find_nodes.filters-textValue',
        'export.nodes-image',
        'get_fill_image',
        'get_font_family_info',
        'get_guide',
      ],
      scope: 'active document and active page only',
      differences: [
        'No cloud files, folders, comments, tokens, AI generation URLs, or cross-page edits.',
        'HTML and CSS are bounded subsets; unsupported properties fail rather than silently disappear.',
        'Exports return content rather than writing files; image export supports PNG/JPEG/WebP/SVG, not PDF/AVIF/video.',
        'Font information is limited to supported local browser-renderable fonts; no Google Fonts lookup.',
      ],
    },
    exports: [
      'svg',
      'html',
      'animated-html',
      'png',
      'jpg',
      'webp',
      'jsx-inline-styles',
      'jsx-tailwind',
    ],
    animatedHtml:
      'Requires the editor export service; returns UNSUPPORTED_OPERATION when unavailable.',
    css: {
      sizing: 'fixed pixels only',
      colors: 'hex, rgb(a), hsl(a), basic named colors',
      layout: 'frame flex row/column, gap, padding, alignment; no wrap/grow/shrink',
      typography: 'supported font families, font size/weight/alignment; no rich text',
      unsupported: [
        'gradients',
        'shadows',
        'tokens',
        'URLs',
        'selectors',
        'grid',
        'percentages',
        'fit-content',
      ],
    },
    html: {
      modes: ['insert-children', 'replace', 'legacy-wrapper'],
      attributes: ['style', 'data-name', 'layer-name'],
      maxElements: 200,
      maxDepth: 20,
      textMetrics: 'estimated',
      positioning: 'flow and flex only',
    },
    limits: {
      maxRequestBytes: 1048576,
      maxResponseBytes: 8388608,
      requestTimeoutMs: 20000,
      rendererTimeoutMs: 15000,
      maxBatchNodes: 200,
      maxScreenshotDimension: 2048,
    },
    security: {
      defaultOff: true,
      loopbackOnly: true,
      browserOrigins: 'rejected',
      remoteFetch: false,
      arbitraryFiles: false,
      arbitraryCode: false,
    },
  };
}

export const FOLIO_GUIDES = Object.freeze({
  'paper-mcp-instructions':
    'These are Folio instructions for Paper-shaped clients. Read get_basic_info to obtain fileId/documentId and active pageId; pass both as guards on edits. Other documents/pages are deliberately unavailable. Create an artboard using name and styles with width/height in px, then use write_html with targetNodeId and insert-children. write_html replace replaces the target and its descendants atomically; returned IDs name the new editable nodes. Use set_text_content with textContent, update_styles with supported literal CSS properties, and move_nodes before/after/index for ordering. Use get_screenshot on a node to verify artwork. Mutations are one undoable editor commit with autosave. No finish_working_on_nodes call is needed: Folio does not expose persistent agent indicators. Unsupported CSS/HTML is rejected, never evaluated. Follow tools/list pagination for get_capabilities and helpers.',
  'mobile-status-bar':
    'Folio editable mobile status bar (no external icons or assets): <div layer-name="Status bar" style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;width:390px;height:44px;padding:12px 20px"><span style="width:60px;font-size:14px;font-weight:700">9:41</span><span style="width:100px;font-size:12px;text-align:right">5G 100%</span></div>',
  'figma-import':
    'Folio cannot open native Figma or Paper files. Read a design through an authorized Figma client, then create editable artboards/text/shapes using the supported Folio tools. Use embedded raster data URLs for image nodes; no remote URL fetching or arbitrary filesystem reads. Verify imported geometry with get_screenshot.',
  'image-generation':
    'Image generation is available only through the explicit Folio UI and the user-configured provider. MCP does not expose provider keys, settings, billable generation, or paper-gen:// URLs. To place an existing image, create_nodes accepts a validated embedded PNG/JPEG/GIF/WebP data URL. Shader source images are also embedded raster data only.',
});
