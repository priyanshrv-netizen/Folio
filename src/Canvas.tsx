import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createNode, worldPosition } from './model';
import { nodeAppearance, nodeInnerShadow } from './model/appearance';
import { ShaderFill } from './shaders/ShaderFill';
import type { DesignDocument, DesignNode, DesignPage, NodeType } from './types';
import './canvas-overlays.css';

export type Tool = 'select' | 'hand' | Exclude<NodeType, 'image'>;
export type View = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };

function parentAngle(node: DesignNode, nodes: DesignNode[]) {
  let angle = 0;
  let parent = nodes.find((item) => item.id === node.parentId);
  while (parent) {
    angle += parent.rotation;
    parent = nodes.find((item) => item.id === parent!.parentId);
  }
  return (angle * Math.PI) / 180;
}

function rotateVector(point: Point, angle: number): Point {
  return {
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
  };
}

function localPoint(point: Point, parent: DesignNode, nodes: DesignNode[]): Point {
  const chain = [parent];
  let ancestor = nodes.find((item) => item.id === parent.parentId);
  while (ancestor) {
    chain.unshift(ancestor);
    ancestor = nodes.find((item) => item.id === ancestor!.parentId);
  }
  for (const node of chain) {
    const rotated = rotateVector(
      {
        x: point.x - node.x - node.width / 2,
        y: point.y - node.y - node.height / 2,
      },
      (-node.rotation * Math.PI) / 180,
    );
    point = { x: rotated.x + node.width / 2, y: rotated.y + node.height / 2 };
  }
  return point;
}

type Gesture = {
  kind: 'move' | 'resize' | 'draw' | 'pan' | 'marquee';
  start: Point;
  current: Point;
  original: DesignDocument;
  ids: string[];
  node?: DesignNode;
  handle?: string;
  view: View;
  additive?: boolean;
};

interface Props {
  document: DesignDocument;
  page: DesignPage;
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  hovered?: string | null;
  setHovered?: (id: string | null) => void;
  commit: (document: DesignDocument) => void;
  tool: Tool;
  setTool: (tool: Tool) => void;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  fitRequest: number;
  showGrid: boolean;
  canvasColor?: string;
}

export function Canvas({
  document,
  page,
  selected,
  setSelected,
  hovered: controlledHovered,
  setHovered: setControlledHovered,
  commit,
  tool,
  setTool,
  view,
  setView,
  fitRequest,
  showGrid,
  canvasColor,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<DesignDocument | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [space, setSpace] = useState(false);
  const [localHovered, setLocalHovered] = useState<string | null>(null);
  const hovered = controlledHovered === undefined ? localHovered : controlledHovered;
  const setHovered = setControlledHovered ?? setLocalHovered;
  const pageRef = useRef(page);
  pageRef.current = page;
  const displayPage = preview?.pages.find((item) => item.id === page.id) ?? page;
  const allNodes = displayPage.nodes;
  const nodesById = new Map(allNodes.map((node) => [node.id, node]));
  const canHover = tool === 'select' && !space && !editing && !gesture.current;

  function isEligible(node: DesignNode): boolean {
    let current: DesignNode | undefined = node;
    while (current) {
      if (!current.visible || current.locked) return false;
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return true;
  }

  const hoverCandidate = hovered ? nodesById.get(hovered) : undefined;
  const hoveredNode =
    canHover && hoverCandidate && isEligible(hoverCandidate) ? hoverCandidate : null;
  const selectedNodes = allNodes.filter((node) => selected.includes(node.id) && isEligible(node));
  const outlinedParents = new Set([
    ...selectedNodes.map((node) => node.id),
    ...(hoveredNode ? [hoveredNode.id] : []),
  ]);
  const outlinedChildren = allNodes.filter(
    (node) =>
      node.parentId &&
      outlinedParents.has(node.parentId) &&
      !selected.includes(node.id) &&
      node.id !== hoveredNode?.id &&
      isEligible(node),
  );

  function overlayBounds(node: DesignNode) {
    const position = worldPosition(node, allNodes);
    const angle = parentAngle(node, allNodes);
    const offset = rotateVector({ x: node.width / 2, y: node.height / 2 }, angle);
    return {
      left: view.x + (position.x + offset.x - node.width / 2) * view.zoom,
      top: view.y + (position.y + offset.y - node.height / 2) * view.zoom,
      width: node.width * view.zoom,
      height: node.height * view.zoom,
      transform: `rotate(${(angle * 180) / Math.PI + node.rotation}deg)`,
    };
  }

  function visiblePolygon(node: DesignNode): Point[] {
    const corners = (node: DesignNode) => {
      const position = worldPosition(node, allNodes);
      const angle = parentAngle(node, allNodes);
      const center = rotateVector({ x: node.width / 2, y: node.height / 2 }, angle);
      return [
        { x: -node.width / 2, y: -node.height / 2 },
        { x: node.width / 2, y: -node.height / 2 },
        { x: node.width / 2, y: node.height / 2 },
        { x: -node.width / 2, y: node.height / 2 },
      ].map((point) => {
        const rotated = rotateVector(point, angle + (node.rotation * Math.PI) / 180);
        return { x: position.x + center.x + rotated.x, y: position.y + center.y + rotated.y };
      });
    };
    let polygon = corners(node);
    let parent = node.parentId ? nodesById.get(node.parentId) : undefined;
    while (parent && polygon.length) {
      if (parent.type === 'frame' && parent.clipContent) {
        const clip = corners(parent);
        for (let edge = 0; edge < clip.length && polygon.length; edge++) {
          const start = clip[edge];
          const end = clip[(edge + 1) % clip.length];
          const distance = (point: Point) =>
            (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
          const output: Point[] = [];
          let previous = polygon[polygon.length - 1];
          let previousDistance = distance(previous);
          for (const point of polygon) {
            const currentDistance = distance(point);
            if (currentDistance >= 0 !== previousDistance >= 0) {
              const ratio = previousDistance / (previousDistance - currentDistance);
              output.push({
                x: previous.x + (point.x - previous.x) * ratio,
                y: previous.y + (point.y - previous.y) * ratio,
              });
            }
            if (currentDistance >= 0) output.push(point);
            previous = point;
            previousDistance = currentDistance;
          }
          polygon = output;
        }
      }
      parent = parent.parentId ? nodesById.get(parent.parentId) : undefined;
    }
    return polygon;
  }

  useEffect(() => {
    setHovered(null);
  }, [document, page.id, setHovered]);

  useEffect(() => {
    if (hovered && !hoveredNode) setHovered(null);
  }, [hovered, hoveredNode, setHovered]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const fit = () => {
      const roots = pageRef.current.nodes.filter((node) => !node.parentId && node.visible);
      if (!roots.length) {
        setView({ x: 100, y: 100, zoom: 1 });
        return;
      }
      const x = Math.min(...roots.map((node) => node.x));
      const y = Math.min(...roots.map((node) => node.y));
      const width = Math.max(...roots.map((node) => node.x + node.width)) - x;
      const height = Math.max(...roots.map((node) => node.y + node.height)) - y;
      const zoom = Math.max(
        0.1,
        Math.min(1, (el.clientWidth - 144) / width, (el.clientHeight - 184) / height),
      );
      setView({
        x: (el.clientWidth - width * zoom) / 2 - x * zoom,
        y: (el.clientHeight - height * zoom - 50) / 2 - y * zoom,
        zoom,
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    setEditing(null);
    setPreview(null);
    return () => observer.disconnect();
  }, [document.id, page.id, fitRequest]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          'input, textarea, [contenteditable="true"], [role="dialog"]',
        )
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        setSpace(true);
        setHovered(null);
      }
      if (event.key === 'Escape') {
        gesture.current = null;
        setPreview(null);
        setMarquee(null);
        setEditing(null);
        setHovered(null);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      gesture.current = null;
      setPreview(null);
      setMarquee(null);
      setHovered(null);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, [setHovered]);

  useEffect(() => {
    const el = viewport.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setHovered(null);
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        setView((previous) => {
          const zoom = Math.max(0.1, Math.min(4, previous.zoom * Math.exp(-event.deltaY * 0.008)));
          return {
            zoom,
            x: x - ((x - previous.x) * zoom) / previous.zoom,
            y: y - ((y - previous.y) * zoom) / previous.zoom,
          };
        });
      } else {
        setView((previous) => ({
          ...previous,
          x: previous.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: previous.y - (event.shiftKey ? 0 : event.deltaY),
        }));
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [setView, setHovered]);

  const point = (event: ReactPointerEvent): Point => {
    const rect = viewport.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - view.x) / view.zoom,
      y: (event.clientY - rect.top - view.y) / view.zoom,
    };
  };

  const rootSelections = (ids: string[]) =>
    ids.filter((id) => {
      let current = page.nodes.find((node) => node.id === id);
      while (current?.parentId) {
        if (ids.includes(current.parentId)) return false;
        current = page.nodes.find((node) => node.id === current!.parentId);
      }
      return true;
    });

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 2 || (event.target as HTMLElement).closest('textarea')) return;
    setHovered(null);
    event.preventDefault();
    viewport.current!.focus();
    viewport.current!.setPointerCapture(event.pointerId);
    const start = point(event);
    const base = {
      start,
      current: start,
      original: document,
      ids: selected,
      view,
    };
    if (event.button === 1 || space || tool === 'hand') {
      gesture.current = {
        ...base,
        kind: 'pan',
        start: { x: event.clientX, y: event.clientY },
      };
      return;
    }
    if (tool !== 'select') {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
      let parent = tool === 'frame' ? undefined : nodesById.get(target?.dataset.nodeId ?? '');
      while (parent && (parent.type !== 'frame' || !isEligible(parent)))
        parent = parent.parentId ? nodesById.get(parent.parentId) : undefined;
      const position = parent ? localPoint(start, parent, page.nodes) : start;
      const node = createNode(tool, {
        parentId: parent?.id ?? null,
        x: position.x,
        y: position.y,
        width: 1,
        height: 1,
      });
      gesture.current = { ...base, kind: 'draw', node };
      return;
    }
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-node-id], [data-selection-id], [data-label-id]',
    );
    const node = page.nodes.find(
      (node) =>
        node.id ===
        (target?.dataset.nodeId ?? target?.dataset.selectionId ?? target?.dataset.labelId),
    );
    if (node && isEligible(node)) {
      const handle = (event.target as HTMLElement).dataset.handle;
      if (handle) {
        gesture.current = {
          ...base,
          kind: 'resize',
          node,
          handle,
          ids: [node.id],
        };
        return;
      }
      const ids = event.shiftKey
        ? selected.includes(node.id)
          ? selected.filter((id) => id !== node.id)
          : [...selected, node.id]
        : selected.includes(node.id)
          ? selected
          : [node.id];
      setSelected(ids);
      gesture.current = {
        ...base,
        kind: 'move',
        ids: rootSelections(ids).filter((id) => {
          const node = nodesById.get(id);
          return node && isEligible(node);
        }),
      };
    } else {
      if (!event.shiftKey) setSelected([]);
      gesture.current = { ...base, kind: 'marquee', additive: event.shiftKey };
    }
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) {
      if (tool !== 'select' || space || editing || event.buttons) {
        setHovered(null);
        return;
      }
      const target = viewport.current?.ownerDocument
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-node-id], [data-label-id]');
      const node =
        target && viewport.current?.contains(target)
          ? nodesById.get((target.dataset.nodeId ?? target.dataset.labelId)!)
          : undefined;
      setHovered(node && isEligible(node) ? node.id : null);
      return;
    }
    if (current.kind === 'pan') {
      setView({
        ...current.view,
        x: current.view.x + event.clientX - current.start.x,
        y: current.view.y + event.clientY - current.start.y,
      });
      return;
    }
    const end = point(event);
    current.current = end;
    const dx = Math.round(end.x - current.start.x);
    const dy = Math.round(end.y - current.start.y);
    if (current.kind === 'marquee') {
      setMarquee({
        x: Math.min(end.x, current.start.x),
        y: Math.min(end.y, current.start.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
      return;
    }
    let nodes = current.original.pages.find((item) => item.id === page.id)!.nodes;
    if (current.kind === 'move') {
      nodes = nodes.map((node) => {
        if (!current.ids.includes(node.id)) return node;
        const delta = rotateVector({ x: dx, y: dy }, -parentAngle(node, nodes));
        return { ...node, x: node.x + delta.x, y: node.y + delta.y };
      });
    } else if (current.kind === 'resize') {
      const node = current.node!;
      const west = current.handle!.includes('w');
      const north = current.handle!.includes('n');
      const angle = (node.rotation * Math.PI) / 180;
      const delta = rotateVector({ x: dx, y: dy }, -parentAngle(node, nodes) - angle);
      const width = Math.max(8, Math.round(node.width + (west ? -delta.x : delta.x)));
      const height = Math.max(8, Math.round(node.height + (north ? -delta.y : delta.y)));
      const centerShift = rotateVector(
        {
          x: ((width - node.width) / 2) * (west ? -1 : 1),
          y: ((height - node.height) / 2) * (north ? -1 : 1),
        },
        angle,
      );
      nodes = nodes.map((item) =>
        item.id === node.id
          ? {
              ...node,
              width,
              height,
              x: node.x + (node.width - width) / 2 + centerShift.x,
              y: node.y + (node.height - height) / 2 + centerShift.y,
            }
          : item,
      );
    } else if (current.kind === 'draw') {
      const delta = rotateVector({ x: dx, y: dy }, -parentAngle(current.node!, nodes));
      const side = Math.max(Math.abs(delta.x), Math.abs(delta.y));
      const width = event.shiftKey ? side : Math.abs(delta.x);
      const height = event.shiftKey ? side : Math.abs(delta.y);
      nodes = [
        ...nodes,
        {
          ...current.node!,
          x: current.node!.x + (delta.x < 0 ? -width : 0),
          y: current.node!.y + (delta.y < 0 ? -height : 0),
          width: Math.max(1, width),
          height: Math.max(1, height),
        },
      ];
    }
    setPreview({
      ...current.original,
      pages: current.original.pages.map((item) =>
        item.id === page.id ? { ...item, nodes } : item,
      ),
    });
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current) return;
    const distance = Math.hypot(
      current.current.x - current.start.x,
      current.current.y - current.start.y,
    );
    if (current.kind === 'draw') {
      const node = current.node!;
      if (distance < 3 || !preview) {
        const defaults = createNode(node.type);
        commit({
          ...document,
          pages: document.pages.map((item) =>
            item.id === page.id
              ? {
                  ...item,
                  nodes: [
                    ...item.nodes,
                    { ...node, width: defaults.width, height: defaults.height },
                  ],
                }
              : item,
          ),
        });
      } else commit(preview);
      setSelected([node.id]);
      setTool('select');
      if (node.type === 'text') setEditing(node.id);
    } else if (current.kind === 'marquee' && marquee) {
      const ids = page.nodes
        .filter((node) => {
          if (!isEligible(node)) return false;
          const polygon = visiblePolygon(node);
          return (
            polygon.length > 2 &&
            polygon.every(
              (point) =>
                point.x >= marquee.x &&
                point.y >= marquee.y &&
                point.x <= marquee.x + marquee.width &&
                point.y <= marquee.y + marquee.height,
            )
          );
        })
        .map((node) => node.id);
      setSelected(rootSelections([...new Set([...(current.additive ? current.ids : []), ...ids])]));
    } else if (preview && distance > 0) commit(preview);
    if (viewport.current?.hasPointerCapture(event.pointerId))
      viewport.current.releasePointerCapture(event.pointerId);
    gesture.current = null;
    setPreview(null);
    setMarquee(null);
  }

  function renderNode(node: DesignNode) {
    if (!node.visible) return null;
    const isSelected = selected.includes(node.id);
    const innerShadow = nodeInnerShadow(node);
    const style: CSSProperties = {
      ...nodeAppearance(node),
      left: node.x,
      top: node.y,
      width: node.width,
      height: node.height,
      transform: `rotate(${node.rotation}deg)`,
      opacity: node.opacity,
      background: node.type === 'text' ? 'transparent' : node.fill,
      color: node.fill,
      borderRadius: node.type === 'ellipse' ? '50%' : node.radius,
      fontFamily: node.fontFamily,
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      textAlign: node.textAlign,
      WebkitTextStroke: node.type === 'text' ? `${node.strokeWidth}px ${node.stroke}` : undefined,
      '--inverse-zoom': 1 / view.zoom,
    } as CSSProperties;
    return (
      <div
        key={node.id}
        data-node-id={node.id}
        data-node-type={node.type}
        data-testid={`node-${node.id}`}
        className={`design-node ${node.type} ${isSelected ? 'selected' : ''} ${!isEligible(node) ? 'locked' : ''}`}
        style={style}
      >
        {node.shader && (
          <div
            className="node-shader-clip"
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              borderRadius:
                node.type === 'ellipse'
                  ? '50%'
                  : Math.min(node.radius, node.width / 2, node.height / 2),
              pointerEvents: 'none',
            }}
          >
            <ShaderFill
              config={node.shader}
              width={node.width}
              height={node.height}
              nodeId={node.id}
            />
          </div>
        )}
        {node.type !== 'text' && (
          <div
            className="node-paint"
            style={{
              position: 'absolute',
              inset: -node.strokeWidth / 2,
              border: `${node.strokeWidth}px solid ${node.stroke}`,
              background: node.shader ? 'transparent' : node.fill,
              borderRadius:
                node.type === 'ellipse'
                  ? '50%'
                  : node.radius
                    ? node.radius + node.strokeWidth / 2
                    : 0,
              pointerEvents: 'none',
            }}
          />
        )}
        {node.type === 'text' &&
          (editing === node.id ? (
            <textarea
              aria-label="Edit text on canvas"
              autoFocus
              defaultValue={node.text}
              onFocus={(event) => event.currentTarget.select()}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (
                  event.key === 'Escape' ||
                  (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
                )
                  event.currentTarget.blur();
              }}
              onBlur={(event) => {
                if (event.target.value !== node.text)
                  commit({
                    ...document,
                    pages: document.pages.map((item) =>
                      item.id === page.id
                        ? {
                            ...item,
                            nodes: item.nodes.map((item) =>
                              item.id === node.id ? { ...item, text: event.target.value } : item,
                            ),
                          }
                        : item,
                    ),
                  });
                setEditing(null);
              }}
            />
          ) : (
            <div className="node-text">{node.text}</div>
          ))}
        {node.type === 'image' && <img src={node.src} alt={node.name} draggable={false} />}
        {node.type === 'image' && node.strokeWidth > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: -node.strokeWidth / 2,
              border: `${node.strokeWidth}px solid ${node.stroke}`,
              borderRadius: node.radius ? node.radius + node.strokeWidth / 2 : 0,
              pointerEvents: 'none',
            }}
          />
        )}
        {allNodes.filter((child) => child.parentId === node.id).map(renderNode)}
        {innerShadow && <div className="node-inner-shadow" style={innerShadow} />}
      </div>
    );
  }

  return (
    <div
      ref={viewport}
      className={`canvas-viewport ${space || tool === 'hand' ? 'panning' : tool !== 'select' ? 'drawing' : ''} ${showGrid ? 'grid-visible' : ''}`}
      tabIndex={0}
      aria-label="Design canvas"
      data-testid="canvas"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerLeave={() => setHovered(null)}
      onDoubleClick={(event) => {
        if (tool !== 'select' || space || editing) return;
        const target = viewport.current?.ownerDocument
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('[data-node-id]');
        const node = nodesById.get(target?.dataset.nodeId ?? '');
        if (!node || node.type !== 'text' || !isEligible(node)) return;
        setHovered(null);
        setEditing(node.id);
        setSelected([node.id]);
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setPreview(null);
        setMarquee(null);
        setHovered(null);
      }}
      style={{
        backgroundColor: canvasColor,
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`,
      }}
    >
      <div
        className="canvas-world"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
        }}
      >
        {allNodes.filter((node) => !node.parentId).map(renderNode)}
        {marquee && <div className="marquee" style={marquee} />}
      </div>
      <div className="canvas-overlays" aria-hidden="true">
        {allNodes
          .filter((node) => node.type === 'frame' && !node.parentId && node.visible)
          .map((node) => (
            <div key={node.id} className="canvas-artboard-overlay" style={overlayBounds(node)}>
              <div className="artboard-label" data-label-id={node.id}>
                {node.name}
              </div>
            </div>
          ))}
        {outlinedChildren.map((node) => (
          <div
            key={node.id}
            className="canvas-child-outline"
            data-child-outline-id={node.id}
            style={overlayBounds(node)}
          />
        ))}
        {hoveredNode && !selected.includes(hoveredNode.id) && (
          <div
            className="canvas-hover-outline"
            data-hover-id={hoveredNode.id}
            style={overlayBounds(hoveredNode)}
          />
        )}
        {selectedNodes.map((node) => (
          <div
            key={node.id}
            className="selection-overlay selected"
            data-selection-id={node.id}
            style={overlayBounds(node)}
          >
            <div className="selection-ring">
              {selected.length === 1 &&
                !editing &&
                ['nw', 'ne', 'sw', 'se'].map((handle) => (
                  <div key={handle} data-handle={handle} className={`resize-handle ${handle}`} />
                ))}
            </div>
          </div>
        ))}
        {!editing &&
          selectedNodes.map((node) => {
            const bounds = overlayBounds(node);
            const angle = parentAngle(node, allNodes) + (node.rotation * Math.PI) / 180;
            const height =
              Math.abs(Math.sin(angle)) * bounds.width + Math.abs(Math.cos(angle)) * bounds.height;

            return (
              <div
                key={node.id}
                className="selection-dimensions"
                data-dimensions-id={node.id}
                style={{
                  left: bounds.left + bounds.width / 2,
                  top: bounds.top + bounds.height / 2 + height / 2 + 8,
                }}
              >
                {node.widthMode === 'fit' ? 'Fit' : Math.round(node.width * 100) / 100}
                {' × '}
                {node.heightMode === 'fit' ? 'Fit' : Math.round(node.height * 100) / 100}
              </div>
            );
          })}
      </div>
      {!page.nodes.length && (
        <div className="empty-canvas">
          <span className="empty-cross">+</span>
          <h2>A little room to create.</h2>
          <p>
            Press <kbd>F</kbd> to draw your first artboard,
            <br />
            or choose a tool below.
          </p>
        </div>
      )}
    </div>
  );
}
