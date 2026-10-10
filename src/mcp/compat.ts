import { duplicateNodes, worldPosition } from '../model';
import { validateDocument } from '../../desktop/persistence/validation.mjs';
import { normalizeColor } from '../../desktop/mcp/css.mjs';
import type { DesignDocument, DesignNode, DesignPage } from '../types';
import type { McpLayout, ToolArguments } from './types';
import { CommandError } from './errors';

export function nodeSummary(node: DesignNode, page: DesignPage) {
  const { src, shader, ...properties } = node;
  const position = worldPosition(node, page.nodes);
  let root = node;
  while (root.parentId) root = page.nodes.find((item) => item.id === root.parentId)!;
  const { source, ...shaderProperties } = shader ?? {};
  return {
    ...properties,
    component: node.type === 'text' ? 'Text' : node.type === 'image' ? 'Image' : 'Frame',
    worldX: position.x,
    worldY: position.y,
    childCount: page.nodes.filter((child) => child.parentId === node.id).length,
    artboardId: root.type === 'frame' ? root.id : null,
    ...(node.type === 'text' ? { textContent: node.text ?? '' } : {}),
    ...(src ? { image: { embedded: true, mimeType: src.slice(5, src.indexOf(';')) } } : {}),
    ...(shader
      ? {
          shader: {
            ...shaderProperties,
            ...(source
              ? { source: { embedded: true, mimeType: source.slice(5, source.indexOf(';')) } }
              : {}),
          },
        }
      : {}),
  };
}

export function computedCss(node: DesignNode): Record<string, string | number> {
  const layout = (node as DesignNode & { layout?: McpLayout }).layout;
  return {
    position: 'absolute',
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.width}px`,
    height: `${node.height}px`,
    display: !node.visible ? 'none' : layout ? 'flex' : 'block',
    opacity: node.opacity,
    transform: `rotate(${node.rotation}deg)`,
    [node.type === 'text' ? 'color' : 'backgroundColor']: node.fill,
    borderColor: node.stroke,
    borderWidth: `${node.strokeWidth}px`,
    borderStyle: 'solid',
    borderRadius: node.type === 'ellipse' ? '50%' : `${node.radius}px`,
    ...(node.type === 'text'
      ? {
          fontSize: `${node.fontSize ?? 24}px`,
          fontFamily: node.fontFamily ?? 'Inter',
          fontWeight: node.fontWeight ?? 400,
          textAlign: node.textAlign ?? 'left',
          whiteSpace: 'pre-wrap',
        }
      : {}),
    ...(layout
      ? {
          flexDirection: layout.direction,
          gap: `${layout.gap}px`,
          paddingTop: `${layout.paddingTop}px`,
          paddingRight: `${layout.paddingRight}px`,
          paddingBottom: `${layout.paddingBottom}px`,
          paddingLeft: `${layout.paddingLeft}px`,
          alignItems: layout.align,
          justifyContent: layout.justify,
        }
      : {}),
  };
}

export function wildcardMatch(value: string, pattern: string): boolean {
  const text = value.toLowerCase();
  const query = pattern.toLowerCase();
  let i = 0;
  let j = 0;
  let star = -1;
  let checkpoint = 0;
  while (i < text.length) {
    if (j < query.length && query[j] === text[i]) {
      i++;
      j++;
    } else if (query[j] === '*') {
      star = j++;
      checkpoint = i;
    } else if (star !== -1) {
      j = star + 1;
      i = ++checkpoint;
    } else return false;
  }
  while (query[j] === '*') j++;
  return j === query.length;
}

export function matchNode(node: DesignNode, args: ToolArguments['find_nodes']) {
  const matched: Record<string, string>[] = [];
  if (args.textValue !== undefined) {
    if (node.type !== 'text' || !wildcardMatch(node.text ?? '', args.textValue)) return null;
    matched.push({ textValue: node.text ?? '' });
  }
  for (const filter of args.filters ?? []) {
    const entries = Object.entries(computedCss(node)).filter(([key, value]) => {
      const kebab = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      if (
        filter.styleName !== undefined &&
        !wildcardMatch(key, filter.styleName) &&
        !wildcardMatch(kebab, filter.styleName)
      )
        return false;
      if (filter.styleValue === undefined) return true;
      if (wildcardMatch(String(value), filter.styleValue)) return true;
      try {
        return normalizeColor(String(value)) === normalizeColor(filter.styleValue);
      } catch {
        return false;
      }
    });
    if (!entries.length) return null;
    matched.push(
      ...entries.map(([styleName, value]) => ({ styleName, styleValue: String(value) })),
    );
  }
  return matched;
}

export function moveCompatible(page: DesignPage, moves: ToolArguments['move_nodes']['moves']) {
  let nodes = page.nodes.map((node) => ({ ...node }));
  const affected = new Set<string | null>();
  const resolved: { nodeId: string; parentId: string; index: number }[] = [];
  const get = (id: string) => {
    const node = nodes.find((node) => node.id === id);
    if (!node) throw new CommandError('NOT_FOUND');
    return node;
  };
  for (const move of moves) {
    const node = get(move.nodeId);
    const relative =
      'before' in move ? get(move.before) : 'after' in move ? get(move.after) : undefined;
    if (relative?.id === node.id) throw new CommandError('INVALID_ARGUMENT');
    const parentId = relative
      ? relative.parentId
      : 'parentId' in move
        ? move.parentId === 'root' || move.parentId === page.id
          ? null
          : move.parentId
        : null;
    let ancestor = parentId ? get(parentId) : undefined;
    if (ancestor && ancestor.type !== 'frame') throw new CommandError('INVALID_ARGUMENT');
    while (ancestor) {
      if (ancestor.id === node.id) throw new CommandError('INVALID_ARGUMENT');
      ancestor = ancestor.parentId ? get(ancestor.parentId) : undefined;
    }
    affected.add(node.parentId);
    affected.add(parentId);
    let x = node.x;
    let y = node.y;
    let rotation = node.rotation;
    if (node.parentId !== parentId) {
      const center = worldPosition(
        { ...node, x: node.x + node.width / 2, y: node.y + node.height / 2 },
        nodes,
      );
      const origin = worldPosition({ ...node, parentId, x: 0, y: 0 }, nodes);
      const basis = worldPosition({ ...node, parentId, x: 1, y: 0 }, nodes);
      const cos = basis.x - origin.x;
      const sin = basis.y - origin.y;
      x = cos * (center.x - origin.x) + sin * (center.y - origin.y) - node.width / 2;
      y = -sin * (center.x - origin.x) + cos * (center.y - origin.y) - node.height / 2;
      const rotationOf = (id: string | null) => {
        let angle = 0;
        let current = id ? get(id) : undefined;
        while (current) {
          angle += current.rotation;
          current = current.parentId ? get(current.parentId) : undefined;
        }
        return angle;
      };
      rotation =
        (((node.rotation + rotationOf(node.parentId) - rotationOf(parentId)) % 360) + 360) % 360;
    }
    const moved = { ...node, parentId, x, y, rotation };
    nodes = nodes.filter((item) => item.id !== node.id);
    const siblings = nodes.filter((item) => item.parentId === parentId);
    const index = relative
      ? siblings.findIndex((item) => item.id === relative.id) + ('after' in move ? 1 : 0)
      : Math.min(
          'index' in move && move.index !== undefined ? move.index : siblings.length,
          siblings.length,
        );
    const globalIndex = siblings[index]
      ? nodes.findIndex((item) => item.id === siblings[index].id)
      : siblings.length
        ? nodes.findIndex((item) => item.id === siblings.at(-1)!.id) + 1
        : nodes.length;
    nodes.splice(globalIndex, 0, moved);
    resolved.push({ nodeId: node.id, parentId: parentId ?? page.id, index });
  }
  return {
    nodes,
    moves: resolved,
    affectedParents: [...affected].map((parentId) => ({
      parentId: parentId ?? page.id,
      children: nodes.filter((node) => node.parentId === parentId).map((node) => node.id),
    })),
  };
}

export function duplicateCompatible(
  document: DesignDocument,
  page: DesignPage,
  specs: { id: string; parentId?: string }[],
) {
  let next = document;
  const copies: { sourceId: string; newId: string; descendantIdMap: Record<string, string> }[] = [];
  for (const spec of specs) {
    const before = next.pages.find((item) => item.id === page.id)!;
    const source = before.nodes.find((node) => node.id === spec.id);
    if (!source) throw new CommandError('NOT_FOUND');
    const parentId =
      spec.parentId === 'root' || spec.parentId === page.id
        ? null
        : (spec.parentId ?? source.parentId);
    if (parentId && before.nodes.find((node) => node.id === parentId)?.type !== 'frame')
      throw new CommandError('INVALID_ARGUMENT');
    const duplicated = duplicateNodes(next, page.id, [source.id]);
    next = duplicated.document;
    const target = next.pages.find((item) => item.id === page.id)!;
    const created = target.nodes.slice(before.nodes.length);
    const descendants = new Set([source.id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const node of before.nodes)
        if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
          descendants.add(node.id);
          changed = true;
        }
    }
    const originals = before.nodes.filter((node) => descendants.has(node.id));
    const map = Object.fromEntries(originals.map((node, index) => [node.id, created[index].id]));
    const root = created.find((node) => node.id === duplicated.ids[0])!;
    root.parentId = parentId;
    if (parentId === null && root.type === 'frame') {
      root.x = Math.max(
        0,
        ...before.nodes
          .filter((node) => node.parentId === null)
          .map((node) => node.x + node.width + 80),
      );
      root.y = source.y;
    }
    copies.push({
      sourceId: source.id,
      newId: root.id,
      descendantIdMap: Object.fromEntries(Object.entries(map).filter(([id]) => id !== source.id)),
    });
  }
  return { document: validateDocument(next), copies, ids: copies.map((copy) => copy.newId) };
}
