import {
  createNode,
  duplicateNodes,
  exportPageHtml,
  exportPageSvg,
  removeNodes,
  worldPosition,
} from '../model';
import { validateDocument } from '../../desktop/persistence/validation.mjs';
import { parseTool } from '../../desktop/mcp/tools.mjs';
import { cssToStyles } from '../../desktop/mcp/css.mjs';
import { FOLIO_GUIDES, mcpCapabilities } from '../../desktop/mcp/capabilities.mjs';
import { prepareShaderSnapshots, SHADER_PRESETS } from '../shaders';
import type { DesignDocument, DesignNode, DesignPage } from '../types';
import type { CssStyles, McpLayout, McpResult, Styles } from './types';
import { CommandError } from './errors';
import { htmlToNodes } from './html';
import { pageJsx, rasterizeSvg, rasterizeImage, fontFamilyInfo } from './render';
import { computedCss, duplicateCompatible, matchNode, moveCompatible, nodeSummary } from './compat';

export type PreparedCommand = { result: McpResult; document?: DesignDocument; selected?: string[] };

export function exportScope(page: DesignPage, nodeId?: string): DesignPage {
  if (!nodeId || nodeId === page.id) return page;
  const root = page.nodes.find((node) => node.id === nodeId);
  if (!root) throw new CommandError('NOT_FOUND');
  const ids = new Set([root.id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const node of page.nodes)
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
  }
  return {
    ...page,
    name: root.name,
    nodes: page.nodes
      .filter((node) => ids.has(node.id))
      .map((node) => (node.id === root.id ? { ...node, parentId: null, x: 0, y: 0 } : node)),
  };
}

export async function prepareCommand(
  input: { name: string; args: unknown },
  document: DesignDocument,
  selected: string[],
  services: { animatedHtml?: (page: DesignPage) => Promise<string> } = {},
): Promise<PreparedCommand> {
  let command;
  try {
    command = parseTool(input.name, input.args);
  } catch {
    throw new CommandError('INVALID_ARGUMENT');
  }
  if (
    (command.args.documentId && command.args.documentId !== document.id) ||
    (command.args.fileId && command.args.fileId !== document.id) ||
    (command.args.pageId && command.args.pageId !== document.activePageId)
  )
    throw new CommandError('STALE_DOCUMENT');
  const page = document.pages.find((page) => page.id === document.activePageId);
  if (!page) throw new CommandError('NOT_READY');
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  const publicNode = (node: DesignNode) => nodeSummary(node, page);
  const cssPatch = (styles: CssStyles, node: DesignNode): Styles => {
    try {
      return cssToStyles(styles, node.type, (node as DesignNode & { layout?: McpLayout }).layout);
    } catch {
      throw new CommandError('INVALID_ARGUMENT');
    }
  };
  const getNode = (id: string) => {
    const node = byId.get(id);
    if (!node) throw new CommandError('NOT_FOUND');
    return node;
  };
  const parent = (id: string | null) => {
    if (id !== null && getNode(id).type !== 'frame') throw new CommandError('INVALID_ARGUMENT');
  };
  const response = (data: Record<string, unknown>): PreparedCommand => ({
    result: { data: { documentId: document.id, fileId: document.id, pageId: page.id, ...data } },
  });
  const mutate = (
    next: DesignDocument,
    data: Record<string, unknown>,
    nextSelection?: string[],
  ): PreparedCommand => {
    try {
      return {
        ...response({ ...data, applied: true }),
        document: validateDocument({ ...next, updatedAt: new Date().toISOString() }),
        selected: nextSelection,
      };
    } catch {
      throw new CommandError('INVALID_ARGUMENT');
    }
  };
  const nodesDocument = (nodes: DesignNode[]) => ({
    ...document,
    pages: document.pages.map((item) => (item.id === page.id ? { ...item, nodes } : item)),
  });
  const patchNodes = (patches: Map<string, Partial<DesignNode>>) =>
    nodesDocument(page.nodes.map((node) => ({ ...node, ...patches.get(node.id) })));
  const paginated = <T>(items: T[], offset: number, limit: number) => ({
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  });

  switch (command.name) {
    case 'get_basic_info':
      return response({
        name: document.name,
        fileName: document.name,
        pageName: page.name,
        rootNodeId: page.id,
        nodeCount: page.nodes.length,
        artboards: page.nodes
          .filter((node) => node.type === 'frame' && !node.parentId)
          .map(publicNode),
        fontFamilies: [
          ...new Set(
            page.nodes
              .filter((node) => node.type === 'text')
              .map((node) => node.fontFamily ?? 'Inter'),
          ),
        ],
        schemaVersion: document.schemaVersion,
        pages: document.pages.map((page) => ({
          id: page.id,
          name: page.name,
          nodeCount: page.nodes.length,
          isActive: page.id === document.activePageId,
          rootNodeId: page.id,
        })),
        limits: {
          maxNodesPerPage: 5000,
          maxNodesPerDocument: 10000,
          maxBatchNodes: 200,
          maxRequestBytes: 1048576,
          maxResponseBytes: 8388608,
        },
        units: 'canvas pixels',
        scope: 'active document and active page',
        compatibility: 'Folio local MCP; not a Paper drop-in API',
        capabilities: mcpCapabilities(),
      });
    case 'get_selection':
      return response({
        nodes: selected.filter((id) => byId.has(id)).map((id) => publicNode(getNode(id))),
      });
    case 'list_shader_presets':
      return response({
        presets:
          command.args.catalog === 'all'
            ? (await import('../shaders/presets')).SHADER_CATALOG
            : SHADER_PRESETS,
      });
    case 'get_capabilities':
      return response(mcpCapabilities());
    case 'get_guide':
      return response({
        topic: command.args.topic,
        content: FOLIO_GUIDES[command.args.topic],
        implementation: 'Folio',
      });
    case 'get_font_family_info':
      return response({
        families: await fontFamilyInfo(command.args.familyNames),
        source: 'supported local browser fonts',
        googleFontsLookup: false,
      });
    case 'get_fill_image': {
      const node = getNode(command.args.nodeId);
      if (node.type !== 'image' || !node.src) return response({ nodeId: node.id, hasImage: false });
      const image = await rasterizeImage(node.src, 'image/jpeg');
      return {
        result: {
          data: {
            documentId: document.id,
            fileId: document.id,
            pageId: page.id,
            nodeId: node.id,
            hasImage: true,
            width: image.width,
            height: image.height,
            embedded: true,
          },
          image: { data: image.data, mimeType: 'image/jpeg' },
        },
      };
    }
    case 'apply_shader': {
      const patches = new Map<string, Partial<DesignNode>>();
      for (const id of command.args.nodeIds) {
        if (!['frame', 'rectangle', 'ellipse'].includes(getNode(id).type))
          throw new CommandError('INVALID_ARGUMENT');
        patches.set(id, { shader: command.args.config ?? undefined });
      }
      return mutate(patchNodes(patches), { nodeIds: [...patches.keys()] });
    }
    case 'get_node_info': {
      if (command.args.nodeId === page.id)
        return response({
          id: page.id,
          name: page.name,
          component: 'Root',
          children: page.nodes.filter((node) => node.parentId === null).map((node) => node.id),
          childCount: page.nodes.filter((node) => node.parentId === null).length,
          parentId: null,
        });
      const node = getNode(command.args.nodeId);
      return response({
        ...publicNode(node),
        node: publicNode(node),
        children: page.nodes.filter((child) => child.parentId === node.id).map((child) => child.id),
      });
    }
    case 'get_children': {
      const args = command.args;
      const parentId =
        args.nodeId === page.id || args.nodeId === 'root'
          ? null
          : (args.nodeId ?? args.parentId ?? null);
      if (parentId !== null) getNode(parentId);
      const children = page.nodes.filter((node) => node.parentId === parentId).map(publicNode);
      return response({
        ...paginated(children, args.offset, args.limit),
        children: children.slice(args.offset, args.offset + args.limit),
      });
    }
    case 'get_tree_summary': {
      const args = command.args;
      const maxDepth = args.depth ?? (args.fileId ? 3 : 4);
      const children = new Map<string | null, DesignNode[]>();
      for (const node of page.nodes)
        children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
      const rows: Record<string, unknown>[] = [];
      const visit = (node: DesignNode, depth: number) => {
        rows.push({
          id: node.id,
          name: node.name,
          type: node.type,
          parentId: node.parentId,
          depth,
          childCount: children.get(node.id)?.length ?? 0,
          width: node.width,
          height: node.height,
        });
        if (depth < maxDepth)
          for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
      };
      for (const root of args.nodeId && args.nodeId !== page.id && args.nodeId !== 'root'
        ? [getNode(args.nodeId)]
        : (children.get(null) ?? []))
        visit(root, 0);
      const summary = rows
        .slice(args.offset, args.offset + args.limit)
        .map(
          (row) =>
            `${'  '.repeat(Number(row.depth))}${row.type} ${JSON.stringify(row.name)} (${row.id}) ${row.width}×${row.height}`,
        )
        .join('\n');
      const result = response({ ...paginated(rows, args.offset, args.limit), summary });
      if (args.fileId) result.result.text = summary;
      return result;
    }
    case 'find_nodes': {
      const args = command.args;
      const query = args.query.toLocaleLowerCase();
      const subtree =
        args.nodeId && args.nodeId !== page.id && args.nodeId !== 'root'
          ? new Set(exportScope(page, args.nodeId).nodes.map((node) => node.id))
          : null;
      const scope = subtree ? page.nodes.filter((node) => subtree.has(node.id)) : page.nodes;
      return response(
        paginated(
          scope
            .filter(
              (node) =>
                (!args.type || node.type === args.type) &&
                (!query ||
                  node.name.toLocaleLowerCase().includes(query) ||
                  node.text?.toLocaleLowerCase().includes(query)) &&
                matchNode(node, args) !== null,
            )
            .map((node) => ({ ...publicNode(node), matched: matchNode(node, args) })),
          args.offset,
          args.limit,
        ),
      );
    }
    case 'get_computed_styles':
      if (command.args.fileId)
        return {
          result: {
            data: Object.fromEntries(
              command.args.nodeIds.map((id) => [id, computedCss(getNode(id))]),
            ),
          },
        };
      return response({
        nodes: command.args.nodeIds.map((id) => {
          const node = getNode(id);
          let opacity = node.opacity;
          let visible = node.visible;
          let rotation = node.rotation;
          let parentId = node.parentId;
          while (parentId) {
            const ancestor = getNode(parentId);
            opacity *= ancestor.opacity;
            visible &&= ancestor.visible;
            rotation += ancestor.rotation;
            parentId = ancestor.parentId;
          }
          const {
            id: nodeId,
            type,
            name: _name,
            parentId: _parent,
            text: _text,
            src: _src,
            ...styles
          } = node;
          return {
            nodeId,
            type,
            styles: {
              ...styles,
              effectiveOpacity: opacity,
              effectiveVisible: visible,
              worldRotation: rotation,
              worldPosition: worldPosition(node, page.nodes),
            },
          };
        }),
      });
    case 'create_artboard': {
      const node = createNode(
        'frame',
        command.args.styles
          ? {
              name: command.args.name,
              x: Math.max(
                0,
                ...page.nodes
                  .filter((node) => !node.parentId)
                  .map((node) => node.x + node.width + 80),
              ),
              ...cssPatch(
                {
                  ...(!command.args.styles.display || command.args.styles.display === 'flex'
                    ? { display: 'flex', flexDirection: 'column' }
                    : {}),
                  ...command.args.styles,
                },
                createNode('frame'),
              ),
            }
          : command.args,
      );
      return mutate(
        nodesDocument([...page.nodes, node]),
        { nodeIds: [node.id], nodeId: node.id, ...publicNode(node) },
        [node.id],
      );
    }
    case 'create_nodes': {
      let created: DesignNode[];
      for (const spec of command.args.nodes) {
        if (
          spec.type !== 'text' &&
          ['text', 'fontSize', 'fontFamily', 'fontWeight', 'textAlign'].some((key) => key in spec)
        )
          throw new CommandError('INVALID_ARGUMENT');
        if (spec.type !== 'image' && spec.src !== undefined)
          throw new CommandError('INVALID_ARGUMENT');
        if (spec.type === 'image' && !spec.src) throw new CommandError('INVALID_ARGUMENT');
      }
      try {
        created = command.args.nodes.map((spec) => createNode(spec.type, spec));
      } catch {
        throw new CommandError('INVALID_ARGUMENT');
      }
      return mutate(
        nodesDocument([...page.nodes, ...created]),
        { nodeIds: created.map((node) => node.id) },
        created.map((node) => node.id),
      );
    }
    case 'update_styles': {
      const patches = new Map<string, Styles>();
      for (const update of command.args.updates)
        for (const id of update.nodeIds) {
          const node = getNode(id);
          const raw = update.styles;
          const modelKeys = [
            'x',
            'y',
            'rotation',
            'fill',
            'stroke',
            'strokeWidth',
            'radius',
            'visible',
            'locked',
          ];
          const nextStyles = modelKeys.some((key) => key in raw)
            ? (raw as Styles)
            : cssPatch(raw as CssStyles, { ...node, ...patches.get(id) });
          if (
            node.type !== 'text' &&
            ['fontSize', 'fontFamily', 'fontWeight', 'textAlign'].some((key) => key in nextStyles)
          )
            throw new CommandError('INVALID_ARGUMENT');
          patches.set(id, { ...patches.get(id), ...nextStyles });
        }
      return mutate(patchNodes(patches), { nodeIds: [...patches.keys()] });
    }
    case 'set_text_content': {
      const patches = new Map<string, Partial<DesignNode>>();
      for (const update of command.args.updates) {
        if (getNode(update.nodeId).type !== 'text') throw new CommandError('INVALID_ARGUMENT');
        patches.set(update.nodeId, {
          text: 'textContent' in update ? update.textContent : update.text,
        });
      }
      return mutate(patchNodes(patches), { nodeIds: [...patches.keys()] });
    }
    case 'rename_nodes': {
      const patches = new Map<string, Partial<DesignNode>>();
      for (const update of command.args.updates) {
        getNode(update.nodeId);
        patches.set(update.nodeId, {
          name: command.args.fileId ? [...update.name].slice(0, 50).join('') : update.name,
        });
      }
      return mutate(patchNodes(patches), { nodeIds: [...patches.keys()] });
    }
    case 'duplicate_nodes': {
      if (command.args.nodes) {
        const result = duplicateCompatible(document, page, command.args.nodes);
        return mutate(result.document, { nodeIds: result.ids, nodes: result.copies }, result.ids);
      }
      command.args.nodeIds!.forEach(getNode);
      try {
        const result = duplicateNodes(document, page.id, command.args.nodeIds!);
        return mutate(result.document, { nodeIds: result.ids }, result.ids);
      } catch (error) {
        if (error instanceof CommandError) throw error;
        throw new CommandError('INVALID_ARGUMENT');
      }
    }
    case 'delete_nodes': {
      command.args.nodeIds.forEach(getNode);
      const next = removeNodes(document, page.id, command.args.nodeIds);
      const remaining = new Set(
        next.pages.find((item) => item.id === page.id)!.nodes.map((node) => node.id),
      );
      return mutate(
        next,
        {
          deletedNodeIds: page.nodes
            .filter((node) => !remaining.has(node.id))
            .map((node) => node.id),
        },
        selected.filter((id) => remaining.has(id)),
      );
    }
    case 'move_nodes': {
      if (
        command.args.fileId ||
        command.args.moves.some(
          (move) =>
            'before' in move ||
            'after' in move ||
            'index' in move ||
            ('parentId' in move && (move.parentId === 'root' || move.parentId === page.id)),
        )
      ) {
        if (command.args.moves.some((move) => 'x' in move || 'y' in move))
          throw new CommandError('INVALID_ARGUMENT');
        const result = moveCompatible(page, command.args.moves);
        return mutate(nodesDocument(result.nodes), {
          nodeIds: result.moves.map((move) => move.nodeId),
          moves: result.moves,
          affectedParents: result.affectedParents,
        });
      }
      const patches = new Map<string, Partial<DesignNode>>();
      for (const move of command.args.moves) {
        if (!('parentId' in move)) throw new CommandError('INVALID_ARGUMENT');
        getNode(move.nodeId);
        parent(move.parentId);
        const { nodeId, ...patch } = move;
        patches.set(nodeId, patch);
      }
      return mutate(patchNodes(patches), { nodeIds: [...patches.keys()] });
    }
    case 'create_page': {
      const nextPage: DesignPage = {
        id: `page-${crypto.randomUUID()}`,
        name:
          command.args.name ??
          (command.args.fileId ? `Page ${document.pages.length + 1}` : 'New page'),
        nodes: [],
      };
      return mutate(
        { ...document, pages: [...document.pages, nextPage] },
        { createdPageId: nextPage.id, ...(command.args.fileId ? { pageId: nextPage.id } : {}) },
      );
    }
    case 'rename_pages': {
      const patches = new Map<string, string>();
      for (const update of command.args.updates) {
        if (!document.pages.some((page) => page.id === update.pageId))
          throw new CommandError('NOT_FOUND');
        patches.set(update.pageId, update.name);
      }
      return mutate(
        {
          ...document,
          pages: document.pages.map((page) => ({
            ...page,
            name: patches.get(page.id) ?? page.name,
          })),
        },
        { pageIds: [...patches.keys()] },
      );
    }
    case 'write_html': {
      if (command.args.targetNodeId && command.args.mode) {
        const args = command.args;
        const target =
          args.targetNodeId === 'root' || args.targetNodeId === page.id
            ? null
            : getNode(args.targetNodeId!);
        if (args.mode === 'replace' && !target) throw new CommandError('INVALID_ARGUMENT');
        if (args.mode === 'insert-children') parent(target?.id ?? null);
        const parentId = args.mode === 'replace' ? target!.parentId : (target?.id ?? null);
        const nodes = htmlToNodes({
          ...args,
          parentId,
          x: 0,
          y: 0,
          width: Math.min(4096, target?.width ?? args.width),
        });
        const wrapper = nodes.shift()!;
        const roots = nodes.filter((node) => node.parentId === wrapper.id);
        const offset =
          args.mode === 'replace'
            ? { x: target!.x, y: target!.y }
            : {
                x: 0,
                y: Math.max(
                  0,
                  ...page.nodes
                    .filter((node) => node.parentId === parentId)
                    .map((node) => node.y + node.height),
                ),
              };
        for (const node of roots) {
          node.parentId = parentId;
          node.x += offset.x;
          node.y += offset.y;
        }
        const retained =
          args.mode === 'replace'
            ? removeNodes(document, page.id, [target!.id]).pages.find(
                (item) => item.id === page.id,
              )!.nodes
            : page.nodes;
        const insertion =
          args.mode === 'replace'
            ? page.nodes.findIndex((node) => node.id === target!.id)
            : retained.length;
        const next = [...retained];
        next.splice(insertion, 0, ...nodes);
        return mutate(
          nodesDocument(next),
          {
            nodeIds: nodes.map((node) => node.id),
            rootIds: roots.map((node) => node.id),
            nodes: nodes.map((node) => ({
              id: node.id,
              name: node.name,
              component: node.type === 'text' ? 'Text' : 'Frame',
            })),
            mode: args.mode,
          },
          roots.map((node) => node.id),
        );
      }
      parent(command.args.parentId);
      let nodes: DesignNode[];
      try {
        nodes = htmlToNodes(command.args);
      } catch (error) {
        if (error instanceof CommandError) throw error;
        throw new CommandError('UNSUPPORTED_HTML');
      }
      return mutate(
        nodesDocument([...page.nodes, ...nodes]),
        {
          nodeIds: nodes.map((node) => node.id),
          rootId: nodes[0].id,
          layout: 'Bounded block/flex subset; text heights use estimated glyph metrics.',
        },
        [nodes[0].id],
      );
    }
    case 'get_jsx': {
      const scope = exportScope(page, command.args.nodeId);
      const snapshots = await prepareShaderSnapshots(scope);
      const format = command.args.format ?? (command.args.fileId ? 'tailwind' : 'inline-styles');
      const code = pageJsx(scope, snapshots, format);
      const result = response({ language: 'jsx', format, code });
      if (command.args.fileId) result.result.text = code;
      return result;
    }
    case 'export': {
      if (command.args.nodes) {
        const output = [];
        for (const [nodeId, formats] of Object.entries(command.args.nodes)) {
          const scope = exportScope(page, nodeId);
          const snapshots = await prepareShaderSnapshots(scope);
          const svg = exportPageSvg(scope, snapshots);
          for (const spec of formats.length ? formats : [{ format: 'png' as const, scale: '1x' }]) {
            const match = /^([\d.]+)(x|w|h|p)$/.exec(spec.scale)!;
            const dimension = /^<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(svg)!;
            const [width, height] = dimension.slice(1).map(Number);
            const scale =
              Number(match[1]) /
              (match[2] === 'w'
                ? width
                : match[2] === 'h'
                  ? height
                  : match[2] === 'p'
                    ? Math.min(width, height)
                    : 1);
            if (!Number.isFinite(scale) || !(scale > 0) || scale > 1_000_000)
              throw new CommandError('INVALID_ARGUMENT');
            if (spec.format === 'svg')
              output.push({
                nodeId,
                format: spec.format,
                mimeType: 'image/svg+xml',
                content: svg
                  .replace(/\bwidth="\d+"/, `width="${Math.max(1, Math.round(width * scale))}"`)
                  .replace(/\bheight="\d+"/, `height="${Math.max(1, Math.round(height * scale))}"`),
              });
            else {
              const mimeType =
                spec.format === 'jpg'
                  ? 'image/jpeg'
                  : spec.format === 'webp'
                    ? 'image/webp'
                    : 'image/png';
              output.push({
                nodeId,
                format: spec.format,
                mimeType,
                encoding: 'base64',
                ...(await rasterizeSvg(svg, scale, mimeType)),
              });
            }
            if (new TextEncoder().encode(JSON.stringify(output)).length > 7 * 1024 * 1024)
              throw new CommandError('LIMIT_EXCEEDED');
          }
        }
        return response({ exports: output, delivery: 'inline content; no files written' });
      }
      const scope = exportScope(page, command.args.nodeId);
      if (command.args.format === 'animated-html') {
        if (!services.animatedHtml) throw new CommandError('UNSUPPORTED_OPERATION');
        return response({
          format: 'animated-html',
          mimeType: 'text/html',
          content: await services.animatedHtml(scope),
        });
      }
      const snapshots = await prepareShaderSnapshots(scope);
      if (['png', 'jpg', 'webp'].includes(command.args.format!)) {
        const mimeType =
          command.args.format === 'jpg'
            ? 'image/jpeg'
            : command.args.format === 'webp'
              ? 'image/webp'
              : 'image/png';
        return response({
          format: command.args.format,
          mimeType,
          encoding: 'base64',
          ...(await rasterizeSvg(exportPageSvg(scope, snapshots), 1, mimeType)),
        });
      }
      return response({
        format: command.args.format,
        mimeType: command.args.format === 'svg' ? 'image/svg+xml' : 'text/html',
        content:
          command.args.format === 'svg'
            ? exportPageSvg(scope, snapshots)
            : exportPageHtml(scope, snapshots),
      });
    }
    case 'get_screenshot': {
      const scope = exportScope(page, command.args.nodeId);
      const snapshots = await prepareShaderSnapshots(scope);
      const { data, width, height } = await rasterizeSvg(
        exportPageSvg(scope, snapshots),
        command.args.scale,
      );
      return {
        result: {
          data: {
            documentId: document.id,
            pageId: page.id,
            nodeId: command.args.nodeId ?? null,
            width,
            height,
            renderer: 'isolated artwork SVG rasterization',
          },
          image: { data, mimeType: 'image/png' },
        },
      };
    }
  }
}
