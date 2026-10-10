import type {
  DesignDocument,
  DesignNode,
  DesignPage,
  NodeType,
  ShaderSnapshots,
  NodeShadow,
} from './types';
import { filterCss, shadowCss } from './model/appearance';
import {
  MAX_DEPTH,
  MAX_DOCUMENT_BYTES,
  validateNode,
  validatePage,
  validateShaderSnapshot,
  validateDocument as validateSharedDocument,
} from '../desktop/persistence/validation.mjs';

type Point = { x: number; y: number };
type Matrix = [number, number, number, number, number, number];
type Scene = { page: DesignPage; children: Map<string | null, DesignNode[]> };

function svgShadow(node: DesignNode, shadow: NodeShadow, id: string, inset = false): string {
  const padding =
    Math.abs(shadow.spread) +
    shadow.blur * 1.5 +
    Math.max(Math.abs(shadow.x), Math.abs(shadow.y)) +
    1;
  const geometry =
    node.type === 'ellipse'
      ? `ellipse cx="${format(node.width / 2)}" cy="${format(node.height / 2)}" rx="${format(node.width / 2)}" ry="${format(node.height / 2)}"`
      : `rect width="${format(node.width)}" height="${format(node.height)}" rx="${format(cornerRadius(node))}"`;
  return (
    `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="${format(-padding)}" y="${format(-padding)}" width="${format(node.width + padding * 2)}" height="${format(node.height + padding * 2)}" color-interpolation-filters="sRGB">` +
    (inset
      ? '<feComponentTransfer in="SourceAlpha" result="inverse"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>'
      : '') +
    `<feMorphology in="${inset ? 'inverse' : 'SourceAlpha'}" operator="${shadow.spread < 0 ? 'erode' : 'dilate'}" radius="${format(Math.abs(shadow.spread))}" result="spread"/>` +
    `<feGaussianBlur in="spread" stdDeviation="${format(shadow.blur / 2)}" result="blur"/>` +
    `<feOffset in="blur" dx="${format(shadow.x)}" dy="${format(shadow.y)}" result="offset"/>` +
    `<feComposite in="offset" in2="SourceAlpha" operator="${inset ? 'in' : 'out'}" result="mask"/>` +
    `<feFlood flood-color="${escape(shadow.color)}"/><feComposite in2="mask" operator="in"/>` +
    `</filter></defs><${geometry} fill="#000000" filter="url(#${id})"/>`
  );
}

function invalid(path: string, message: string): never {
  throw new Error(`Invalid document: ${path} ${message}`);
}

export function validateDocument(input: unknown): DesignDocument {
  return validateSharedDocument(input);
}

function checkPageSize(page: DesignPage): void {
  const json = JSON.stringify(page);
  if (
    json.length > MAX_DOCUMENT_BYTES ||
    new TextEncoder().encode(json).length > MAX_DOCUMENT_BYTES
  ) {
    invalid('page', 'exceeds the 32 MiB serialized document limit.');
  }
}

function newId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function createDocument(name = 'Untitled'): DesignDocument {
  const page: DesignPage = { id: newId('page'), name: 'Page 1', nodes: [] };
  const now = new Date().toISOString();
  return validateDocument({
    schemaVersion: 1,
    id: newId('document'),
    name,
    pages: [page],
    activePageId: page.id,
    createdAt: now,
    updatedAt: now,
  });
}

export function createNode(type: NodeType, overrides: Partial<DesignNode> = {}): DesignNode {
  const text = type === 'text';
  return validateNode(
    {
      id: newId('node'),
      name: typeof type === 'string' ? type.charAt(0).toUpperCase() + type.slice(1) : '',
      parentId: null,
      x: 0,
      y: 0,
      width:
        type === 'frame'
          ? 640
          : text
            ? 240
            : type === 'ellipse'
              ? 120
              : type === 'rectangle'
                ? 180
                : 200,
      height: type === 'frame' ? 480 : text ? 60 : type === 'image' ? 160 : 120,
      rotation: 0,
      fill: type === 'frame' ? '#ffffff' : text ? '#172033' : '#b8bcf5',
      stroke: 'transparent',
      strokeWidth: 0,
      radius: 0,
      opacity: 1,
      visible: true,
      locked: false,
      ...(text
        ? { text: 'Text', fontSize: 24, fontFamily: 'Inter', fontWeight: 400, textAlign: 'left' }
        : {}),
      ...overrides,
      type,
    },
    'node',
    { nodes: 0, text: 0, imageBytes: 0 },
  );
}

function findPage(doc: DesignDocument, pageId: string): DesignPage {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`Page "${pageId}" does not exist.`);
  return page;
}

export function addPage(doc: DesignDocument): DesignDocument {
  const names = new Set(doc.pages.map((page) => page.name.trim().toLowerCase()));
  let number = 1;
  while (names.has(`page ${number}`)) number += 1;
  const page: DesignPage = { id: newId('page'), name: `Page ${number}`, nodes: [] };
  return validateDocument({
    ...doc,
    pages: [...doc.pages, page],
    activePageId: page.id,
  });
}

export function renamePage(doc: DesignDocument, pageId: string, name: string): DesignDocument {
  const page = findPage(doc, pageId);
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 256) throw new Error('Enter a page name of 1–256 characters.');
  if (page.name === trimmed) return doc;
  return validateDocument({
    ...doc,
    pages: doc.pages.map((item) => (item.id === pageId ? { ...item, name: trimmed } : item)),
  });
}

export function movePage(doc: DesignDocument, pageId: string, index: number): DesignDocument {
  const page = findPage(doc, pageId);
  if (!Number.isInteger(index) || index < 0 || index >= doc.pages.length)
    throw new Error('The page position must be an index within the document.');
  if (doc.pages.indexOf(page) === index) return doc;
  const pages = doc.pages.filter((item) => item.id !== pageId);
  pages.splice(index, 0, page);
  return validateDocument({ ...doc, pages });
}

export function removePage(doc: DesignDocument, pageId: string): DesignDocument {
  const page = findPage(doc, pageId);
  if (doc.pages.length === 1) throw new Error('Keep at least one page in the document.');
  const index = doc.pages.indexOf(page);
  const pages = doc.pages.filter((item) => item.id !== pageId);
  return validateDocument({
    ...doc,
    pages,
    activePageId:
      doc.activePageId === pageId ? pages[Math.min(index, pages.length - 1)].id : doc.activePageId,
  });
}

function replaceNodes(doc: DesignDocument, pageId: string, nodes: DesignNode[]): DesignDocument {
  return validateDocument({
    ...doc,
    pages: doc.pages.map((page) => (page.id === pageId ? { ...page, nodes } : page)),
    updatedAt: new Date().toISOString(),
  });
}

export function updateNodes(
  doc: DesignDocument,
  pageId: string,
  ids: string[],
  patch: Partial<DesignNode>,
): DesignDocument {
  const page = findPage(doc, pageId);
  const selected = new Set(ids);
  if (!page.nodes.some((node) => selected.has(node.id))) return doc;
  const nodes = page.nodes.map((node) => {
    if (!selected.has(node.id)) return node;
    if (patch.id !== undefined && patch.id !== node.id) {
      throw new Error('Node IDs cannot be changed by updateNodes.');
    }
    const next = { ...node, ...patch };
    if (patch.fill !== undefined && !Object.hasOwn(patch, 'fillTokenId')) delete next.fillTokenId;
    if (Object.hasOwn(patch, 'layout') && patch.layout === undefined) {
      if (next.widthMode === 'fit') delete next.widthMode;
      if (next.heightMode === 'fit') delete next.heightMode;
    }
    return next;
  });
  return replaceNodes(doc, pageId, nodes);
}

function childrenByParent(nodes: DesignNode[]): Map<string | null, DesignNode[]> {
  const children = new Map<string | null, DesignNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId);
    if (siblings) siblings.push(node);
    else children.set(node.parentId, [node]);
  }
  return children;
}

function subtreeIds(nodes: DesignNode[], ids: string[]): Set<string> {
  const children = childrenByParent(nodes);
  const result = new Set<string>();
  const pending = [...ids];
  while (pending.length) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }
  return result;
}

export function removeNodes(doc: DesignDocument, pageId: string, ids: string[]): DesignDocument {
  const page = findPage(doc, pageId);
  const removed = subtreeIds(page.nodes, ids);
  const nodes = page.nodes.filter((node) => !removed.has(node.id));
  return nodes.length === page.nodes.length ? doc : replaceNodes(doc, pageId, nodes);
}

export function duplicateNodes(
  doc: DesignDocument,
  pageId: string,
  ids: string[],
): { document: DesignDocument; ids: string[] } {
  const page = findPage(doc, pageId);
  const selected = new Set(ids);
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  const roots = page.nodes.filter((node) => {
    if (!selected.has(node.id)) return false;
    let parentId = node.parentId;
    const visited = new Set([node.id]);
    while (parentId !== null) {
      if (visited.has(parentId)) invalid('nodes', 'contains a parent cycle.');
      visited.add(parentId);
      if (selected.has(parentId)) return false;
      const parent = byId.get(parentId);
      if (!parent) invalid('nodes', 'must reference a parent in the same page.');
      parentId = parent.parentId;
    }
    return true;
  });
  if (!roots.length) return { document: doc, ids: [] };
  const rootIds = new Set(roots.map((node) => node.id));
  const copiedIds = subtreeIds(page.nodes, [...rootIds]);
  const newIds = new Map([...copiedIds].map((id) => [id, newId('node')]));
  const copies = page.nodes
    .filter((node) => copiedIds.has(node.id))
    .map((node) => ({
      ...node,
      id: newIds.get(node.id)!,
      name: rootIds.has(node.id)
        ? `${node.name.slice(0, 251).replace(/[\ud800-\udbff]$/, '')} copy`
        : node.name,
      parentId: node.parentId === null ? null : (newIds.get(node.parentId) ?? node.parentId),
      x: node.x + (rootIds.has(node.id) ? 24 : 0),
      y: node.y + (rootIds.has(node.id) ? 24 : 0),
    }));
  return {
    document: replaceNodes(doc, pageId, [...page.nodes, ...copies]),
    ids: roots.map((node) => newIds.get(node.id)!),
  };
}

function localMatrix(node: DesignNode): Matrix {
  const angle = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = node.width / 2;
  const cy = node.height / 2;
  return [
    cos,
    sin,
    -sin,
    cos,
    node.x + cx - cos * cx + sin * cy,
    node.y + cy - sin * cx - cos * cy,
  ];
}

function transform(matrix: Matrix, point: Point): Point {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function worldPosition(node: DesignNode, nodes: DesignNode[]): { x: number; y: number } {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const visited = new Set([node.id]);
  let point = { x: node.x, y: node.y };
  let parentId = node.parentId;
  while (parentId !== null) {
    if (visited.has(parentId)) invalid('nodes', 'contains a parent cycle.');
    visited.add(parentId);
    if (visited.size > MAX_DEPTH) invalid('nodes', `exceeds the ${MAX_DEPTH} level nesting limit.`);
    const parent = byId.get(parentId);
    if (!parent || parent.type !== 'frame')
      invalid('nodes', 'must reference a parent frame in the same page.');
    point = transform(localMatrix(parent), point);
    parentId = parent.parentId;
  }
  return point;
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

function format(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function sceneFor(input: DesignPage): Scene {
  const page = validatePage(input, 'page', new Set(), { nodes: 0, text: 0, imageBytes: 0 });
  checkPageSize(page);
  return { page, children: childrenByParent(page.nodes) };
}

function textLines(node: DesignNode): string[] {
  return (node.text ?? '').replace(/\r\n?/g, '\n').split('\n');
}

function boundsFor(scene: Scene): { x: number; y: number; width: number; height: number } {
  type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
  const empty = (): Bounds => ({
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });
  const union = (a: Bounds, b: Bounds): Bounds => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  });
  const rectangle = (
    matrix: Matrix,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): Bounds => {
    const points = [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ].map((point) => transform(matrix, point));
    return {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    };
  };
  const visit = (node: DesignNode, parent: Matrix): Bounds => {
    if (!node.visible || node.opacity === 0) return empty();
    const matrix = multiply(parent, localMatrix(node));
    const stroke = node.type === 'text' || node.stroke === 'transparent' ? 0 : node.strokeWidth / 2;
    let bounds = rectangle(matrix, -stroke, -stroke, node.width + stroke, node.height + stroke);
    for (const child of scene.children.get(node.id) ?? [])
      bounds = union(bounds, visit(child, matrix));
    if (node.type === 'frame' && node.clipContent) {
      const clip = rectangle(matrix, 0, 0, node.width, node.height);
      bounds = {
        minX: Math.max(bounds.minX, clip.minX),
        minY: Math.max(bounds.minY, clip.minY),
        maxX: Math.min(bounds.maxX, clip.maxX),
        maxY: Math.min(bounds.maxY, clip.maxY),
      };
    }
    if (node.shadow && node.shadow.color !== 'transparent') {
      const shadow = node.shadow;
      const outset = shadow.spread + shadow.blur * 1.5;
      bounds = union(
        bounds,
        rectangle(
          matrix,
          shadow.x - outset,
          shadow.y - outset,
          node.width + shadow.x + outset,
          node.height + shadow.y + outset,
        ),
      );
    }
    const blur = (node.filters?.blur ?? 0) * 3;
    return {
      minX: bounds.minX - blur,
      minY: bounds.minY - blur,
      maxX: bounds.maxX + blur,
      maxY: bounds.maxY + blur,
    };
  };
  let bounds = empty();
  for (const root of scene.children.get(null) ?? [])
    bounds = union(bounds, visit(root, [1, 0, 0, 1, 0, 0]));
  const { minX, minY, maxX, maxY } = bounds;
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1200, height: 800 };
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(maxX) - x),
    height: Math.max(1, Math.ceil(maxY) - y),
  };
}

function cornerRadius(node: DesignNode): number {
  return Math.min(node.radius, node.width / 2, node.height / 2);
}

function shaderSnapshotFor(
  node: DesignNode,
  snapshots: ShaderSnapshots,
  budget: { imageBytes: number },
): string {
  if (!Object.hasOwn(snapshots, node.id)) {
    throw new Error(
      `The Paper shader on “${node.name}” needs a snapshot before export. Call prepareShaderSnapshots(page) first.`,
    );
  }
  return validateShaderSnapshot(snapshots[node.id], `shader snapshot for ${node.id}`, budget);
}

export function exportPageSvg(page: DesignPage, snapshots: ShaderSnapshots = {}): string {
  const scene = sceneFor(page);
  const bounds = boundsFor(scene);
  let imageClipIndex = 0;
  let textClipIndex = 0;
  let shaderClipIndex = 0;
  let appearanceIndex = 0;
  const snapshotBudget = { imageBytes: 0 };
  const render = (node: DesignNode): string => {
    if (!node.visible || node.opacity === 0) return '';
    const width = format(node.width);
    const height = format(node.height);
    const radius = format(cornerRadius(node));
    const paint = `fill="${escape(node.fill)}" stroke="${escape(node.stroke)}" stroke-width="${format(node.strokeWidth)}"`;
    const rectangle = `width="${width}" height="${height}" rx="${radius}"`;
    let shape: string;
    const appearanceId = `folio-appearance-${appearanceIndex++}`;
    if (node.shader) {
      const snapshot = shaderSnapshotFor(node, snapshots, snapshotBudget);
      const clipId = `folio-shader-${shaderClipIndex++}`;
      const geometry =
        node.type === 'ellipse'
          ? `ellipse cx="${format(node.width / 2)}" cy="${format(node.height / 2)}" rx="${format(node.width / 2)}" ry="${format(node.height / 2)}"`
          : `rect ${rectangle}`;
      shape =
        `<defs><clipPath id="${clipId}"><${geometry}/></clipPath></defs>` +
        `<${geometry} fill="${escape(node.fill)}"/>` +
        `<image data-shader-kind="${node.shader.kind}" data-shader-export="snapshot" width="${width}" height="${height}" href="${escape(snapshot)}" preserveAspectRatio="none" clip-path="url(#${clipId})"/>` +
        `<${geometry} fill="transparent" stroke="${escape(node.stroke)}" stroke-width="${format(node.strokeWidth)}"/>`;
    } else if (node.type === 'ellipse') {
      shape = `<ellipse cx="${format(node.width / 2)}" cy="${format(node.height / 2)}" rx="${format(node.width / 2)}" ry="${format(node.height / 2)}" ${paint}/>`;
    } else if (node.type === 'text') {
      const size = node.fontSize ?? 24;
      const clipId = `folio-text-${textClipIndex++}`;
      const x = format(
        node.textAlign === 'right' ? node.width : node.textAlign === 'center' ? node.width / 2 : 0,
      );
      const anchor =
        node.textAlign === 'right' ? 'end' : node.textAlign === 'center' ? 'middle' : 'start';
      const lines = textLines(node)
        .map(
          (line, index) =>
            `<tspan x="${x}" y="${format(size + index * size * 1.2)}">${escape(line)}</tspan>`,
        )
        .join('');
      shape =
        `<defs><clipPath id="${clipId}"><rect width="${width}" height="${height}"/></clipPath></defs>` +
        `<text ${paint} font-family="${escape(node.fontFamily ?? 'Inter')}" font-size="${format(size)}" font-weight="${node.fontWeight ?? 400}" text-anchor="${anchor}" xml:space="preserve" clip-path="url(#${clipId})">${lines}</text>`;
    } else if (node.type === 'image' && node.src) {
      const clipId = `folio-image-${imageClipIndex++}`;
      shape =
        `<defs><clipPath id="${clipId}"><rect ${rectangle}/></clipPath></defs>` +
        `<rect ${rectangle} fill="${escape(node.fill)}"/>` +
        `<image width="${width}" height="${height}" href="${escape(node.src)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>` +
        `<rect ${rectangle} fill="transparent" stroke="${escape(node.stroke)}" stroke-width="${format(node.strokeWidth)}"/>`;
    } else {
      shape = `<rect ${rectangle} ${paint}/>`;
    }
    let content =
      shape +
      (scene.children.get(node.id) ?? []).map(render).join('') +
      (node.innerShadow ? svgShadow(node, node.innerShadow, `${appearanceId}-inner`, true) : '');
    if (node.type === 'frame' && node.clipContent) {
      content =
        `<defs><clipPath id="${appearanceId}-clip"><rect ${rectangle}/></clipPath></defs>` +
        `<g clip-path="url(#${appearanceId}-clip)">${content}</g>`;
    }
    const filter = filterCss(node.filters);
    const style =
      (node.blendMode && node.blendMode !== 'normal' ? `mix-blend-mode:${node.blendMode};` : '') +
      (filter ? `filter:${filter};` : '');
    return (
      `<g data-node-id="${escape(node.id)}" transform="translate(${format(node.x)} ${format(node.y)}) rotate(${format(node.rotation)} ${format(node.width / 2)} ${format(node.height / 2)})" opacity="${format(node.opacity)}"${style ? ` style="${escape(style)}"` : ''}>` +
      `<title>${escape(node.name)}</title>` +
      (node.shadow ? svgShadow(node, node.shadow, `${appearanceId}-shadow`) : '') +
      content +
      '</g>'
    );
  };
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img" aria-label="${escape(scene.page.name)}">` +
    `<title>${escape(scene.page.name)}</title>` +
    (scene.children.get(null) ?? []).map(render).join('') +
    '</svg>'
  );
}

export function exportPageHtml(page: DesignPage, snapshots: ShaderSnapshots = {}): string {
  const scene = sceneFor(page);
  const bounds = boundsFor(scene);
  const snapshotBudget = { imageBytes: 0 };
  const render = (node: DesignNode): string => {
    if (!node.visible || node.opacity === 0) return '';
    const root = node.parentId === null;
    const placement =
      `position:absolute;left:${format(node.x - (root ? bounds.x : 0))}px;top:${format(node.y - (root ? bounds.y : 0))}px;` +
      `width:${format(node.width)}px;height:${format(node.height)}px;transform:rotate(${format(node.rotation)}deg);transform-origin:center center;opacity:${format(node.opacity)};` +
      `border-radius:${node.type === 'ellipse' ? '50%' : `${format(cornerRadius(node))}px`};` +
      (node.type === 'frame' && node.clipContent ? 'overflow:hidden;' : '') +
      (node.blendMode && node.blendMode !== 'normal' ? `mix-blend-mode:${node.blendMode};` : '') +
      (node.shadow ? `box-shadow:${shadowCss(node.shadow)};` : '') +
      (filterCss(node.filters) ? `filter:${filterCss(node.filters)};` : '');
    let content: string;
    if (node.type === 'text') {
      const style =
        `white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden;width:100%;height:100%;tab-size:4;font-family:${node.fontFamily ?? 'Inter'};font-size:${format(node.fontSize ?? 24)}px;` +
        `font-weight:${node.fontWeight ?? 400};line-height:1.2;text-align:${node.textAlign ?? 'left'};color:${node.fill};` +
        `-webkit-text-stroke:${format(node.strokeWidth)}px ${node.stroke};`;
      content = `<div style="${escape(style)}">${escape(textLines(node).join('\n'))}</div>`;
    } else {
      const border = node.stroke === 'transparent' ? 0 : node.strokeWidth;
      const radius = cornerRadius(node);
      const fillRadius = node.type === 'ellipse' ? '50%' : `${format(radius)}px`;
      const fill = `position:absolute;inset:0;background:${node.fill};border-radius:${fillRadius};`;
      const style =
        `position:absolute;left:${format(-border / 2)}px;top:${format(-border / 2)}px;` +
        `width:${format(node.width + border)}px;height:${format(node.height + border)}px;box-sizing:border-box;` +
        `border:${format(border)}px solid ${node.stroke};` +
        `border-radius:${node.type === 'ellipse' ? '50%' : `${format(radius === 0 ? 0 : radius + border / 2)}px`};`;
      const image =
        node.type === 'image' && node.src
          ? `<img src="${escape(node.src)}" alt="${escape(node.name)}" style="position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;border-radius:${format(radius)}px;">`
          : '';
      const shader = node.shader
        ? `<img data-shader-kind="${node.shader.kind}" data-shader-export="snapshot" src="${escape(shaderSnapshotFor(node, snapshots, snapshotBudget))}" alt="${escape(node.name)}" style="position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:fill;border-radius:${fillRadius};">`
        : '';
      content = `<div style="${escape(fill)}"></div>${image}${shader}<div style="${escape(style)}"></div>`;
    }
    return (
      `<div data-node-id="${escape(node.id)}" aria-label="${escape(node.name)}" style="${escape(placement)}">` +
      content +
      (scene.children.get(node.id) ?? []).map(render).join('') +
      (node.innerShadow
        ? `<div aria-hidden="true" style="position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:${escape(shadowCss(node.innerShadow, true))};"></div>`
        : '') +
      '</div>'
    );
  };
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escape(scene.page.name)}</title></head><body style="margin:0;">` +
    `<main aria-label="${escape(scene.page.name)}" style="position:relative;width:${bounds.width}px;height:${bounds.height}px;">` +
    (scene.children.get(null) ?? []).map(render).join('') +
    '</main></body></html>'
  );
}
