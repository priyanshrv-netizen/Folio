import type { CSSProperties } from 'react';
import type { DesignNode, NodeFilters, NodeShadow } from '../types';

export { BLEND_MODES } from '../../desktop/persistence/validation.mjs';

export const DEFAULT_SHADOW: NodeShadow = { color: '#00000040', x: 0, y: 4, blur: 8, spread: 0 };
export const DEFAULT_INNER_SHADOW: NodeShadow = {
  color: '#00000040',
  x: 0,
  y: 2,
  blur: 4,
  spread: 0,
};
export const DEFAULT_FILTERS: NodeFilters = { blur: 0, brightness: 1, contrast: 1, saturation: 1 };

export function shadowCss(shadow: NodeShadow, inset = false): string {
  return `${inset ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`;
}

export function filterCss(filters?: NodeFilters): string | undefined {
  if (!filters) return undefined;
  const values = [
    filters.blur !== 0 ? `blur(${filters.blur}px)` : '',
    filters.brightness !== 1 ? `brightness(${filters.brightness})` : '',
    filters.contrast !== 1 ? `contrast(${filters.contrast})` : '',
    filters.saturation !== 1 ? `saturate(${filters.saturation})` : '',
  ].filter(Boolean);
  return values.length ? values.join(' ') : undefined;
}

export function nodeAppearance(node: DesignNode): CSSProperties {
  return {
    overflow: node.type === 'frame' ? (node.clipContent ? 'hidden' : 'visible') : undefined,
    mixBlendMode: node.blendMode ?? 'normal',
    boxShadow: node.shadow ? shadowCss(node.shadow) : undefined,
    filter: filterCss(node.filters),
  };
}

export function nodeInnerShadow(node: DesignNode): CSSProperties | undefined {
  if (!node.innerShadow) return undefined;
  return {
    position: 'absolute',
    inset: 0,
    borderRadius:
      node.type === 'ellipse' ? '50%' : Math.min(node.radius, node.width / 2, node.height / 2),
    boxShadow: shadowCss(node.innerShadow, true),
    pointerEvents: 'none',
  };
}
