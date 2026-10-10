import { shaderDefinition } from '../../src/shaders/schema.mjs';
import { validateLayout, reflowNodes } from './layout.mjs';

export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DEPTH = 100;

const NODE_TYPES = ['frame', 'rectangle', 'ellipse', 'text', 'image'];
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plus-lighter',
];

const FONT_FAMILIES = new Set([
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
]);
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function invalid(path, message) {
  throw new Error(`Invalid document: ${path} ${message}`);
}

function record(value, path) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    invalid(path, 'must be a plain object.');
  }
  return value;
}

function string(value, path, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    invalid(
      path,
      `must be ${allowEmpty ? 'a' : 'a non-empty'} string of at most ${max} characters.`,
    );
  }
  for (const character of value) {
    const code = character.codePointAt(0);
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      invalid(path, 'contains an unsupported control character.');
    }
  }
  return value;
}

export function validateId(value, path = 'id') {
  const result = string(value, path, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(result)) {
    invalid(path, 'must contain only letters, digits, hyphens, and underscores.');
  }
  return result;
}

function number(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(path, `must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') invalid(path, 'must be a boolean.');
  return value;
}

function color(value, path) {
  if (
    typeof value !== 'string' ||
    !/^(?:transparent|#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8}))$/.test(value)
  ) {
    invalid(path, 'must be a hex color or transparent.');
  }
  return value;
}

function timestamp(value, path) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    invalid(path, 'must be a valid ISO UTC timestamp.');
  }
  return value;
}

export function rasterMime(bytes) {
  const startsWith = (signature, offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (startsWith([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (startsWith([255, 216, 255])) return 'image/jpeg';
  if (startsWith([71, 73, 70, 56, 55, 97]) || startsWith([71, 73, 70, 56, 57, 97]))
    return 'image/gif';
  if (startsWith([82, 73, 70, 70]) && startsWith([87, 69, 66, 80], 8)) return 'image/webp';
  throw new Error('Image must contain PNG, JPEG, GIF, or WebP raster bytes.');
}

export function validateBase64(encoded, maxBytes = MAX_IMAGE_BYTES) {
  if (
    typeof encoded !== 'string' ||
    !encoded ||
    encoded.length > Math.ceil(maxBytes / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new Error('Invalid or oversized base64 image data.');
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const lastDigit = BASE64.indexOf(encoded[encoded.length - padding - 1]);
  if (
    (padding === 2 && (lastDigit & 15) !== 0) ||
    (padding === 1 && (lastDigit & 3) !== 0) ||
    (encoded.length / 4) * 3 - padding > maxBytes
  ) {
    throw new Error('Invalid or oversized base64 image data.');
  }
  return (encoded.length / 4) * 3 - padding;
}

function imageSource(value, path, budget) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32) {
    invalid(path, 'must be an embedded raster image of at most 10 MiB.');
  }
  const header = /^data:(image\/(?:png|jpeg|gif|webp));base64,/.exec(value);
  if (!header) invalid(path, 'must be an embedded PNG, JPEG, GIF, or WebP base64 data URL.');
  const encoded = value.slice(header[0].length);
  let byteLength;
  try {
    byteLength = validateBase64(encoded);
  } catch {
    invalid(path, 'contains invalid or oversized base64 image data.');
  }
  budget.imageBytes += byteLength;
  if (budget.imageBytes > 20 * 1024 * 1024) invalid(path, 'exceeds the 20 MiB total image limit.');
  const bytes = [];
  for (let index = 0; index < Math.min(encoded.length, 24); index += 4) {
    const bits =
      (BASE64.indexOf(encoded[index]) << 18) |
      (BASE64.indexOf(encoded[index + 1]) << 12) |
      (Math.max(0, BASE64.indexOf(encoded[index + 2])) << 6) |
      Math.max(0, BASE64.indexOf(encoded[index + 3]));
    bytes.push((bits >> 16) & 255, (bits >> 8) & 255, bits & 255);
  }
  try {
    if (rasterMime(bytes.slice(0, byteLength)) !== header[1]) throw new Error();
  } catch {
    invalid(path, 'does not match its declared raster image format.');
  }
  return value;
}

export function validateShaderSource(input, path = 'shader.source', budget = { imageBytes: 0 }) {
  return imageSource(input, path, budget);
}

export function validateShaderConfig(input, path = 'shader', budget = { imageBytes: 0 }) {
  const source = record(input, path);
  const definition = typeof source.kind === 'string' ? shaderDefinition(source.kind) : undefined;
  if (!definition) invalid(`${path}.kind`, 'must be a supported Paper shader preset.');
  const maxColors = definition.maxColors;
  if (!Array.isArray(source.colors) || source.colors.length < 2 || source.colors.length > maxColors)
    invalid(`${path}.colors`, `must contain between 2 and ${maxColors} colors.`);
  const config = {
    kind: source.kind,
    colors: Array.from(source.colors, (value, index) => color(value, `${path}.colors[${index}]`)),
    speed: number(source.speed, `${path}.speed`, 0, 3),
    scale: number(source.scale, `${path}.scale`, 0.25, 4),
    detail: number(source.detail, `${path}.detail`, 0, 1),
    paused: boolean(source.paused, `${path}.paused`),
  };
  if (source.source !== undefined) {
    if (!definition.supportsImage)
      invalid(`${path}.source`, 'is only supported by image filters and logo shaders.');
    config.source = validateShaderSource(source.source, `${path}.source`, budget);
  }
  if (source.parameters !== undefined) {
    const parameters = record(source.parameters, `${path}.parameters`);
    config.parameters = {};
    for (const [name, rule] of Object.entries(definition.parameters)) {
      if (!Object.hasOwn(parameters, name)) continue;
      const field = `${path}.parameters.${name}`;
      const value = parameters[name];
      if (rule.type === 'boolean') config.parameters[name] = boolean(value, field);
      else {
        config.parameters[name] = number(value, field, rule.min, rule.max);
        if (rule.step === 1 && !Number.isInteger(value)) invalid(field, 'must be an integer.');
        if (rule.options && !rule.options.some((option) => option.value === value))
          invalid(field, 'must be a supported option.');
      }
    }
  }
  return config;
}

export function validateShaderSnapshot(
  input,
  path = 'shader snapshot',
  budget = { imageBytes: 0 },
) {
  if (typeof input !== 'string' || !input.startsWith('data:image/png;base64,'))
    invalid(path, 'must be an embedded PNG snapshot.');
  return imageSource(input, path, budget);
}

export function validateNode(input, path = 'node', budget = { nodes: 0, text: 0, imageBytes: 0 }) {
  const source = record(input, path);
  if (!NODE_TYPES.includes(source.type)) invalid(`${path}.type`, 'is not a supported node type.');
  const node = {
    id: validateId(source.id, `${path}.id`),
    type: source.type,
    name: string(source.name, `${path}.name`, 256),
    parentId: source.parentId === null ? null : validateId(source.parentId, `${path}.parentId`),
    x: number(source.x, `${path}.x`, -1_000_000, 1_000_000),
    y: number(source.y, `${path}.y`, -1_000_000, 1_000_000),
    width: number(source.width, `${path}.width`, 1, 100_000),
    height: number(source.height, `${path}.height`, 1, 100_000),
    rotation: number(source.rotation, `${path}.rotation`, -360, 360),
    fill: color(source.fill, `${path}.fill`),
    stroke: color(source.stroke, `${path}.stroke`),
    strokeWidth: number(source.strokeWidth, `${path}.strokeWidth`, 0, 1_000),
    radius: number(source.radius, `${path}.radius`, 0, 100_000),
    opacity: number(source.opacity, `${path}.opacity`, 0, 1),
    visible: boolean(source.visible, `${path}.visible`),
    locked: boolean(source.locked, `${path}.locked`),
  };
  if (source.shader !== undefined) {
    if (!['frame', 'rectangle', 'ellipse'].includes(source.type))
      invalid(`${path}.shader`, 'is only supported on frames, rectangles, and ellipses.');
    node.shader = validateShaderConfig(source.shader, `${path}.shader`, budget);
  }
  if (source.layout !== undefined) {
    if (source.type !== 'frame') invalid(`${path}.layout`, 'is only supported on frames.');
    node.layout = validateLayout(source.layout, `${path}.layout`);
  }
  for (const field of ['widthMode', 'heightMode']) {
    if (source[field] === undefined) continue;
    if (source.type !== 'frame') invalid(`${path}.${field}`, 'is only supported on frames.');
    if (!['fixed', 'fit'].includes(source[field]))
      invalid(`${path}.${field}`, 'must be fixed or fit.');
    if (source[field] === 'fit' && !node.layout)
      invalid(`${path}.${field}`, 'requires a flex layout to fit its contents.');
    node[field] = source[field];
  }
  if (source.clipContent !== undefined) {
    if (source.type !== 'frame') invalid(`${path}.clipContent`, 'is only supported on frames.');
    node.clipContent = boolean(source.clipContent, `${path}.clipContent`);
  }
  if (source.blendMode !== undefined) {
    if (!BLEND_MODES.includes(source.blendMode))
      invalid(`${path}.blendMode`, 'must be a supported blend mode.');
    node.blendMode = source.blendMode;
  }
  for (const field of ['shadow', 'innerShadow']) {
    if (source[field] === undefined) continue;
    const shadow = record(source[field], `${path}.${field}`);
    node[field] = {
      color: color(shadow.color, `${path}.${field}.color`),
      x: number(shadow.x, `${path}.${field}.x`, -1000, 1000),
      y: number(shadow.y, `${path}.${field}.y`, -1000, 1000),
      blur: number(shadow.blur, `${path}.${field}.blur`, 0, 1000),
      spread: number(shadow.spread, `${path}.${field}.spread`, -1000, 1000),
    };
  }
  if (source.filters !== undefined) {
    const filters = record(source.filters, `${path}.filters`);
    node.filters = {
      blur: number(filters.blur, `${path}.filters.blur`, 0, 100),
      brightness: number(filters.brightness, `${path}.filters.brightness`, 0, 4),
      contrast: number(filters.contrast, `${path}.filters.contrast`, 0, 4),
      saturation: number(filters.saturation, `${path}.filters.saturation`, 0, 4),
    };
  }
  if (source.fillTokenId !== undefined)
    node.fillTokenId = validateId(source.fillTokenId, `${path}.fillTokenId`);
  if (source.text !== undefined) {
    node.text = string(source.text, `${path}.text`, 100_000, true);
    budget.text += node.text.length;
    if (budget.text > 1_000_000)
      invalid(`${path}.text`, 'exceeds the 1,000,000 character total text limit.');
  }
  if (source.fontSize !== undefined)
    node.fontSize = number(source.fontSize, `${path}.fontSize`, 1, 1_000);
  if (source.fontFamily !== undefined) {
    if (!FONT_FAMILIES.has(source.fontFamily))
      invalid(`${path}.fontFamily`, 'must be a supported font family.');
    node.fontFamily = source.fontFamily;
  }
  if (source.fontWeight !== undefined) {
    node.fontWeight = number(source.fontWeight, `${path}.fontWeight`, 1, 1_000);
    if (!Number.isInteger(node.fontWeight)) invalid(`${path}.fontWeight`, 'must be an integer.');
  }
  if (source.textAlign !== undefined) {
    if (!['left', 'center', 'right'].includes(source.textAlign))
      invalid(`${path}.textAlign`, 'must be left, center, or right.');
    node.textAlign = source.textAlign;
  }
  if (source.src !== undefined) node.src = imageSource(source.src, `${path}.src`, budget);
  return node;
}

function uniqueId(id, ids, path) {
  if (ids.has(id)) invalid(path, 'duplicates an ID.');
  ids.add(id);
}

export function validatePage(
  input,
  path = 'page',
  ids = new Set(),
  budget = { nodes: 0, text: 0, imageBytes: 0 },
) {
  const source = record(input, path);
  const id = validateId(source.id, `${path}.id`);
  uniqueId(id, ids, `${path}.id`);
  const name = string(source.name, `${path}.name`, 256);
  if (!Array.isArray(source.nodes) || source.nodes.length > 5_000)
    invalid(`${path}.nodes`, 'must contain at most 5,000 nodes.');
  budget.nodes += source.nodes.length;
  if (budget.nodes > 10_000) invalid(`${path}.nodes`, 'exceeds the 10,000 node document limit.');
  const nodes = Array.from(source.nodes, (value, index) => {
    const node = validateNode(value, `${path}.nodes[${index}]`, budget);
    uniqueId(node.id, ids, `${path}.nodes[${index}].id`);
    return node;
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depths = new Map();
  for (const node of nodes) {
    const ancestors = [];
    const visiting = new Set();
    let current = node;
    while (current && !depths.has(current.id)) {
      if (visiting.has(current.id)) invalid(path, 'contains a parent cycle.');
      visiting.add(current.id);
      ancestors.push(current.id);
      if (ancestors.length > MAX_DEPTH)
        invalid(path, `exceeds the ${MAX_DEPTH} level nesting limit.`);
      if (current.parentId === null) current = undefined;
      else {
        const parent = byId.get(current.parentId);
        if (!parent || parent.type !== 'frame')
          invalid(path, 'must reference a parent frame in the same page.');
        current = parent;
      }
    }
    let depth = current ? depths.get(current.id) : 0;
    for (const ancestor of ancestors.reverse()) {
      depth += 1;
      if (depth > MAX_DEPTH) invalid(path, `exceeds the ${MAX_DEPTH} level nesting limit.`);
      depths.set(ancestor, depth);
    }
  }
  const page = { id, name, nodes: reflowNodes(nodes) };
  if (source.canvasColor !== undefined) {
    page.canvasColor = color(source.canvasColor, `${path}.canvasColor`);
    if (page.canvasColor === 'transparent') invalid(`${path}.canvasColor`, 'must be a hex color.');
  }
  return page;
}

export function validateDocument(input) {
  const source = record(input, 'document');
  let serialized;
  try {
    serialized = JSON.stringify(source);
  } catch {
    invalid('document', 'must be serializable JSON.');
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_DOCUMENT_BYTES)
    invalid('document', 'exceeds the 32 MiB limit.');
  if (source.schemaVersion !== 1) invalid('schemaVersion', 'must be 1.');
  const id = validateId(source.id);
  const name = string(source.name, 'name', 256);
  if (!Array.isArray(source.pages) || source.pages.length < 1 || source.pages.length > 100) {
    invalid('pages', 'must contain between 1 and 100 pages.');
  }
  const ids = new Set([id]);
  let tokens;
  if (source.tokens !== undefined) {
    if (!Array.isArray(source.tokens) || source.tokens.length > 256)
      invalid('tokens', 'must contain at most 256 color tokens.');
    const tokenIds = new Set();
    const tokenNames = new Set();
    tokens = Array.from(source.tokens, (input, index) => {
      const path = `tokens[${index}]`;
      const token = record(input, path);
      const id = validateId(token.id, `${path}.id`);
      const name = string(token.name, `${path}.name`, 128).trim();
      uniqueId(id, tokenIds, `${path}.id`);
      if (tokenNames.has(name.toLowerCase())) invalid(`${path}.name`, 'duplicates a token name.');
      tokenNames.add(name.toLowerCase());
      const value = color(token.value, `${path}.value`);
      if (!/^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(value))
        invalid(`${path}.value`, 'must be an opaque hex color.');
      return { id, name, value };
    });
  }
  const budget = { nodes: 0, text: 0, imageBytes: 0 };
  const pages = Array.from(source.pages, (page, index) =>
    validatePage(page, `pages[${index}]`, ids, budget),
  );
  const tokenValues = new Map((tokens ?? []).map((token) => [token.id, token.value]));
  for (const [pageIndex, page] of pages.entries()) {
    for (const [nodeIndex, node] of page.nodes.entries()) {
      if (node.fillTokenId === undefined) continue;
      if (!tokenValues.has(node.fillTokenId))
        invalid(
          `pages[${pageIndex}].nodes[${nodeIndex}].fillTokenId`,
          'must reference an existing color token.',
        );
      node.fill = tokenValues.get(node.fillTokenId);
    }
  }
  const activePageId = validateId(source.activePageId, 'activePageId');
  if (!pages.some((page) => page.id === activePageId))
    invalid('activePageId', 'must reference an existing page.');
  return {
    schemaVersion: 1,
    id,
    name,
    pages,
    activePageId,
    ...(tokens?.length ? { tokens } : {}),
    createdAt: timestamp(source.createdAt, 'createdAt'),
    updatedAt: timestamp(source.updatedAt, 'updatedAt'),
  };
}

export function documentSummary(document) {
  return {
    id: document.id,
    name: document.name,
    updatedAt: document.updatedAt,
    pageCount: document.pages.length,
  };
}
