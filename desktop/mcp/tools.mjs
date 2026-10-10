import { z } from 'zod';
import { cssPixels, normalizeColor } from './css.mjs';
import { SHADER_DEFINITIONS } from '../../src/shaders/schema.mjs';
import { validateShaderConfig } from '../persistence/validation.mjs';

const id = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
  .max(128);
const name = z.string().trim().min(1).max(256);
const color = z
  .string()
  .regex(/^(?:transparent|#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8}))$/);
const coordinate = z.number().min(-1_000_000).max(1_000_000);
const dimension = z.number().min(1).max(100_000);
const ids = z
  .array(id)
  .min(1)
  .max(200)
  .refine((values) => new Set(values).size === values.length, 'IDs must be unique.');
const scope = { documentId: id.optional(), fileId: id.optional(), pageId: id.optional() };
const pagination = {
  offset: z.number().int().min(0).max(5000).default(0),
  limit: z.number().int().min(1).max(200).default(100),
};
const nodeTypes = z.enum(['frame', 'rectangle', 'ellipse', 'text', 'image']);

const shader = z
  .discriminatedUnion(
    'kind',
    Object.entries({ ...SHADER_DEFINITIONS, 'smoke-ring': SHADER_DEFINITIONS.smoke }).map(
      ([kind, definition]) =>
        z
          .object({
            kind: z.literal(kind),
            colors: z.array(color).min(2).max(definition.maxColors),
            speed: z.number().min(0).max(3),
            scale: z.number().min(0.25).max(4),
            detail: z.number().min(0).max(1),
            paused: z.boolean(),
            source: definition.supportsImage
              ? z
                  .string()
                  .max(1_000_000)
                  .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
                  .optional()
              : z.never().optional(),
            parameters: z
              .object(
                Object.fromEntries(
                  Object.entries(definition.parameters).map(([key, parameter]) => [
                    key,
                    (parameter.type === 'boolean'
                      ? z.boolean()
                      : parameter.options
                        ? z.union(parameter.options.map((option) => z.literal(option.value)))
                        : z.number().min(parameter.min).max(parameter.max)
                    ).optional(),
                  ]),
                ),
              )
              .strict()
              .optional(),
          })
          .strict(),
    ),
  )
  .refine((value) => {
    try {
      validateShaderConfig(value);
      return true;
    } catch {
      return false;
    }
  }, 'Unsupported shader configuration.');
const cssColor = z
  .string()
  .max(128)
  .refine((value) => {
    try {
      normalizeColor(value);
      return true;
    } catch {
      return false;
    }
  }, 'Use a supported literal CSS color.');
const cssNumber = (min, max) =>
  z.union([z.number(), z.string().max(64)]).refine((value) => {
    try {
      const number = cssPixels(value);
      return number >= min && number <= max;
    } catch {
      return false;
    }
  }, 'Use a bounded pixel value.');
const cssStyles = z
  .object({
    width: cssNumber(1, 100_000).optional(),
    height: cssNumber(1, 100_000).optional(),
    left: cssNumber(-1_000_000, 1_000_000).optional(),
    top: cssNumber(-1_000_000, 1_000_000).optional(),
    background: cssColor.optional(),
    backgroundColor: cssColor.optional(),
    color: cssColor.optional(),
    borderColor: cssColor.optional(),
    borderWidth: cssNumber(0, 1000).optional(),
    borderRadius: cssNumber(0, 100_000).optional(),
    border: z
      .string()
      .max(200)
      .regex(/^\d+(?:\.\d+)?(?:px)?\s+solid\s+.+$/)
      .optional(),
    opacity: z
      .union([z.number().min(0).max(1), z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/)])
      .optional(),
    fontSize: cssNumber(1, 1000).optional(),
    fontFamily: z
      .enum([
        'Inter',
        'Arial',
        'Helvetica',
        'Verdana',
        'Tahoma',
        'Trebuchet MS',
        'Georgia',
        'Times New Roman',
        'Courier New',
        'system-ui',
        'sans-serif',
        'serif',
        'monospace',
      ])
      .optional(),
    fontWeight: z
      .union([
        z.number().int().min(1).max(1000),
        z.enum(['normal', 'bold']),
        z.string().regex(/^(?:[1-9]\d{0,2}|1000)$/),
      ])
      .optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    visibility: z.enum(['visible', 'hidden']).optional(),
    display: z.enum(['flex', 'block', 'none']).optional(),
    flexDirection: z.enum(['row', 'column']).optional(),
    gap: cssNumber(0, 100_000).optional(),
    padding: z
      .union([
        cssNumber(0, 100_000),
        z
          .string()
          .max(256)
          .regex(/^(?:\d+(?:\.\d+)?px\s+){1,3}\d+(?:\.\d+)?px$/),
      ])
      .optional(),
    paddingTop: cssNumber(0, 100_000).optional(),
    paddingRight: cssNumber(0, 100_000).optional(),
    paddingBottom: cssNumber(0, 100_000).optional(),
    paddingLeft: cssNumber(0, 100_000).optional(),
    alignItems: z.enum(['start', 'center', 'end', 'stretch', 'flex-start', 'flex-end']).optional(),
    justifyContent: z
      .enum(['start', 'center', 'end', 'space-between', 'flex-start', 'flex-end'])
      .optional(),
    transform: z
      .string()
      .max(64)
      .regex(/^rotate\([-+\d.]+deg\)$/)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one style is required.');
const styles = z
  .object({
    x: coordinate.optional(),
    y: coordinate.optional(),
    width: dimension.optional(),
    height: dimension.optional(),
    rotation: z.number().min(-360).max(360).optional(),
    fill: color.optional(),
    stroke: color.optional(),
    strokeWidth: z.number().min(0).max(1000).optional(),
    radius: z.number().min(0).max(100_000).optional(),
    opacity: z.number().min(0).max(1).optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    fontSize: z.number().min(1).max(1000).optional(),
    fontFamily: z
      .enum([
        'Inter',
        'Arial',
        'Helvetica',
        'Verdana',
        'Tahoma',
        'Trebuchet MS',
        'Georgia',
        'Times New Roman',
        'Courier New',
        'system-ui',
        'sans-serif',
        'serif',
        'monospace',
      ])
      .optional(),
    fontWeight: z.number().int().min(1).max(1000).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
  })
  .strict();
const node = styles
  .extend({
    type: nodeTypes,
    id: id.optional(),
    name: name.optional(),
    parentId: id.nullable().optional(),
    text: z.string().max(100_000).optional(),
    src: z.string().max(1_000_000).optional(),
  })
  .strict();

function tool(name, description, fields = {}, mutating = false) {
  return Object.freeze({
    name,
    description,
    schema: z.object({ ...scope, ...fields }).strict(),
    mutating,
  });
}

export const TOOL_DEFINITIONS = Object.freeze([
  tool(
    'get_basic_info',
    'Read the active document, page summaries and limits. Only the currently open document is available.',
  ),
  tool('get_selection', 'Read selected nodes on the active page. Image bytes are omitted.'),
  tool(
    'get_node_info',
    'Read one node and its child IDs, world coordinates and component on the active page. fileId aliases documentId. Image bytes are omitted.',
    { nodeId: id },
  ),
  tool(
    'get_children',
    'Read direct children via Paper nodeId or legacy parentId. The active page ID or root selects page roots. Results are bounded and paginated.',
    {
      parentId: id.nullable().optional(),
      nodeId: id.optional(),
      ...pagination,
    },
  ),
  tool(
    'get_tree_summary',
    'Read a bounded, depth-first tree of the active page or a node subtree.',
    { nodeId: id.optional(), depth: z.number().int().min(0).max(20).optional(), ...pagination },
  ),
  tool(
    'find_nodes',
    'Find active-page nodes by legacy query/type or Paper textValue/filters. textValue and CSS styleName/styleValue support anchored * wildcards and filters use AND. Literal colors match by equivalence. nodeId bounds a subtree. No tokens, cross-page search, or regular expressions.',
    {
      query: z.string().max(256).default(''),
      type: nodeTypes.optional(),
      ...pagination,
      nodeId: id.optional(),
      textValue: z.string().max(256).optional(),
      filters: z
        .array(
          z
            .object({
              styleName: z.string().max(64).optional(),
              styleValue: z.string().max(256).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(32)
        .optional(),
    },
  ),
  tool(
    'get_computed_styles',
    'With fileId, return a map of nodeId to supported CSS properties. Legacy calls return model styles, effective opacity/visibility and world positions. These are resolved model values, not arbitrary browser CSS inheritance.',
    { nodeIds: ids },
  ),
  tool(
    'list_shader_presets',
    'Read the six featured presets, or the full installed effect catalog with catalog: "all". Returns safe editable Folio configurations.',
    { catalog: z.enum(['featured', 'all']).default('featured') },
  ),
  tool(
    'apply_shader',
    'Set a full validated configuration from the 30-effect shader catalog on frames/rectangles/ellipses, or remove with null. Per-kind parameter allowlists and embedded raster-only sources. One atomic undoable editor transaction.',
    { nodeIds: ids, config: shader.nullable() },
    true,
  ),
  tool(
    'create_artboard',
    'Create one editable artboard. Paper styles require width/height in whole px and support bounded literal CSS and persistent flex layout. Paper-style artboards are placed to the right of existing artwork with an 80px gap and default to flex column. Legacy numeric geometry fields are retained.',
    {
      name: name.default('Artboard'),
      x: coordinate.default(0),
      y: coordinate.default(0),
      width: dimension.default(1440),
      height: dimension.default(900),
      fill: color.default('#ffffff'),
      styles: cssStyles
        .refine(
          (value) =>
            typeof value.width === 'string' &&
            /^\d+px$/.test(value.width) &&
            typeof value.height === 'string' &&
            /^\d+px$/.test(value.height),
          'Artboards require whole pixel width and height.',
        )
        .optional(),
    },
    true,
  ),
  tool(
    'create_nodes',
    'Create nodes atomically. Optional explicit IDs let children reference frames created in this same batch. Images must be embedded raster data URLs; no remote URLs.',
    { nodes: z.array(node).min(1).max(200) },
    true,
  ),
  tool(
    'update_styles',
    'Patch supported model styles or literal CSS styles atomically. CSS supports pixel sizes/positions, solid colors/borders, opacity, typography, visibility, rotation and persistent frame flexDirection/gap/padding/alignItems/justifyContent. Flex properties require display:flex or an existing layout. Unsupported CSS fails the whole batch; no URLs, scripts, tokens or arbitrary properties.',
    {
      updates: z
        .array(
          z
            .object({
              nodeIds: ids,
              styles: z.union([
                styles.refine(
                  (value) => Object.keys(value).length > 0,
                  'At least one style is required.',
                ),
                cssStyles,
              ]),
            })
            .strict(),
        )
        .min(1)
        .max(200),
    },
    true,
  ),
  tool(
    'set_text_content',
    'Replace text on text nodes atomically; all IDs must exist and be text nodes.',
    {
      updates: z
        .array(
          z.union([
            z.object({ nodeId: id, text: z.string().max(100_000) }).strict(),
            z.object({ nodeId: id, textContent: z.string().max(100_000) }).strict(),
          ]),
        )
        .min(1)
        .max(200),
    },
    true,
  ),
  tool(
    'rename_nodes',
    'Rename existing nodes atomically.',
    {
      updates: z
        .array(z.object({ nodeId: id, name }).strict())
        .min(1)
        .max(200),
    },
    true,
  ),
  tool(
    'duplicate_nodes',
    'Paper nodes:[{id,parentId?}] deep-clones each subtree and returns source/new IDs plus descendantIdMap; copied artboards avoid overlaps. Legacy nodeIds deduplicates ancestor/child overlap and offsets roots 24 pixels. Active page only, one atomic transaction.',
    {
      nodeIds: ids.optional(),
      nodes: z
        .array(z.object({ id, parentId: id.optional() }).strict())
        .min(1)
        .max(200)
        .optional(),
    },
    true,
  ),
  tool(
    'delete_nodes',
    'Delete nodes and all descendants atomically. Missing IDs fail without changing the document.',
    { nodeIds: ids },
    true,
  ),
  tool(
    'move_nodes',
    'Paper fileId calls accept before/after siblings or parentId/index, applied sequentially with IDs preserved and freeform world centers/rotations preserved. root or active page ID targets page roots. Returns moves and affectedParents. Legacy parentId/x/y calls preserve local coordinates. Cross-page moves and cycles are rejected atomically.',
    {
      moves: z
        .array(
          z.union([
            z
              .object({
                nodeId: id,
                parentId: id.nullable(),
                x: coordinate.optional(),
                y: coordinate.optional(),
                index: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
              })
              .strict(),
            z.object({ nodeId: id, before: id }).strict(),
            z.object({ nodeId: id, after: id }).strict(),
          ]),
        )
        .min(1)
        .max(200),
    },
    true,
  ),
  tool(
    'create_page',
    'Add an empty page to the active document. Does not switch the current page.',
    { name: name.optional() },
    true,
  ),
  tool(
    'rename_pages',
    'Rename pages within the active document atomically.',
    {
      updates: z
        .array(z.object({ pageId: id, name }).strict())
        .min(1)
        .max(100),
    },
    true,
  ),
  tool(
    'get_jsx',
    'Export artwork as escaped React JSX. format:inline-styles is self-contained; format:tailwind uses absolute utilities with inline fallback for exact numeric geometry. Paper fileId calls default to tailwind and return code text. Legacy defaults to inline styles. Shader fills are rendered PNG stills.',
    { nodeId: id.optional(), format: z.enum(['inline-styles', 'tailwind']).optional() },
  ),
  tool(
    'export',
    'Export artwork as inline content, never filesystem writes. Legacy format supports SVG, static HTML, animated-html via the editor export service, PNG/JPG/WebP. Paper nodes:{id:[{format,scale}]} supports image exports (SVG/PNG/JPG/WebP) with x/w/h/p scales and [] default PNG. Raster output caps at 2048px per side. No stored export settings, AVIF, PDF, MP4 or video contract.',
    {
      format: z.enum(['svg', 'html', 'animated-html', 'png', 'jpg', 'webp']).optional(),
      nodeId: id.optional(),
      type: z.literal('image').optional(),
      nodes: z
        .record(
          id,
          z
            .array(
              z
                .object({
                  format: z.enum(['svg', 'png', 'jpg', 'webp']),
                  scale: z
                    .string()
                    .max(32)
                    .regex(/^\d+(\.\d+)?(x|w|h|p)$/),
                })
                .strict(),
            )
            .max(8),
        )
        .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 20)
        .optional(),
    },
  ),
  tool(
    'get_screenshot',
    'Rasterize isolated SVG artwork as PNG, bounded to 2048 pixels per side. Optional nodeId selects only its subtree. Never captures application chrome, dialogs, or credentials. Shader fills use actual rendered PNG snapshots.',
    { nodeId: id.optional(), scale: z.number().min(0.1).max(4).default(1) },
  ),
  tool(
    'write_html',
    'Import bounded HTML as editable frames/text. Paper targetNodeId+mode insert-children appends parsed roots directly; replace atomically replaces the target subtree in sibling order. Paper imports retain flex layout. Legacy parentId/x/y/width wraps the import. Allowed tags: div, section, article, main, header, footer, nav, aside, p, span, h1-h6, button, strong, br. Attributes: style/data-name/layer-name only. CSS: pixel width/height, literal hex/rgb/hsl/basic named colors, typography, padding, border-radius, solid border, opacity, flex row/column, gap, alignment. Non-flex elements stack vertically including spans; estimated text metrics, no inline runs. No URLs, images, scripts, events, classes, selectors, positioning, flex wrap/grow/shrink, margins, percentages or external resources. At most 200 elements/20 levels. Unsupported input fails atomically.',
    {
      html: z.string().min(1).max(100_000),
      parentId: id.nullable().default(null),
      x: coordinate.default(0),
      y: coordinate.default(0),
      width: z.number().min(1).max(4096).default(800),
      name: name.default('HTML import'),
      targetNodeId: id.optional(),
      mode: z.enum(['insert-children', 'replace']).optional(),
    },
    true,
  ),
]);

export const HELPER_DEFINITIONS = Object.freeze([
  tool(
    'get_capabilities',
    'Read Folio MCP API version, verified compatibility scope and security limits.',
  ),
  tool(
    'get_fill_image',
    'Read an embedded raster image fill as bounded JPEG image content. No filesystem paths, original image URLs, or network requests.',
    { nodeId: id },
  ),
  tool(
    'get_font_family_info',
    'Check Folio-supported font families and browser-renderable weights/styles locally. Does not enumerate system fonts or query Google Fonts.',
    { familyNames: z.array(z.string().trim().min(1).max(128)).min(1).max(50) },
  ),
  tool(
    'get_guide',
    'Read Folio-specific guidance for the observed Paper topic names. These are Folio instructions, not copied Paper instructions.',
    {
      topic: z.enum([
        'paper-mcp-instructions',
        'mobile-status-bar',
        'figma-import',
        'image-generation',
      ]),
    },
  ),
]);
export const ALL_TOOL_DEFINITIONS = Object.freeze([...TOOL_DEFINITIONS, ...HELPER_DEFINITIONS]);

export function parseTool(name, args) {
  const definition = ALL_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) throw new Error('Unknown Folio tool.');
  const parsed = definition.schema.parse(args);
  if (
    name === 'create_artboard' &&
    parsed.styles &&
    (parsed.x !== 0 ||
      parsed.y !== 0 ||
      parsed.width !== 1440 ||
      parsed.height !== 900 ||
      parsed.fill !== '#ffffff')
  )
    throw new Error('Choose CSS styles or legacy geometry, not both.');
  if (
    name === 'write_html' &&
    parsed.mode &&
    (parsed.parentId !== null ||
      parsed.x !== 0 ||
      parsed.y !== 0 ||
      parsed.width !== 800 ||
      parsed.name !== 'HTML import')
  )
    throw new Error('Choose a target/mode or legacy wrapper options, not both.');
  if (name === 'duplicate_nodes' && Boolean(parsed.nodes) === Boolean(parsed.nodeIds))
    throw new Error('Choose one duplication shape.');
  if (name === 'write_html' && Boolean(parsed.targetNodeId) !== Boolean(parsed.mode))
    throw new Error('Target and mode are required together.');
  if (name === 'get_children' && parsed.parentId !== undefined && parsed.nodeId !== undefined)
    throw new Error('Choose one parent.');
  if (name === 'export' && Boolean(parsed.format) === Boolean(parsed.nodes))
    throw new Error('Choose one export shape.');
  return { name, args: parsed };
}
