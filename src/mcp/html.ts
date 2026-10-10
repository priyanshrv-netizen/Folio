import { createNode } from '../model';
import type { DesignNode } from '../types';
import type { ToolArguments } from './types';
import { CommandError } from './errors';
import { normalizeColor } from '../../desktop/mcp/css.mjs';

const tags = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'p',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'button',
  'strong',
  'br',
]);
const textTags = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong']);
const fonts = new Set([
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
type Style = {
  width?: number;
  height?: number;
  fill?: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  textAlign: 'left' | 'center' | 'right';
  padding: number[];
  gap: number;
  row: boolean;
  flex: boolean;
  align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'space-between';
  radius: number;
  opacity: number;
  stroke: string;
  strokeWidth: number;
};
type Box = {
  label: string;
  style: Style;
  text?: string;
  children: Box[];
  width: number;
  height: number;
  x: number;
  y: number;
};
const defaults: Style = {
  color: '#172033',
  fontSize: 16,
  fontFamily: 'Inter',
  fontWeight: 400,
  textAlign: 'left',
  padding: [0, 0, 0, 0],
  gap: 0,
  row: false,
  flex: false,
  align: 'stretch',
  justify: 'start',
  radius: 0,
  opacity: 1,
  stroke: 'transparent',
  strokeWidth: 0,
};
const unsupported = (): never => {
  throw new CommandError('UNSUPPORTED_HTML');
};
const pixels = (value: string, max = 4096) => {
  if (!/^(?:0|\d+(?:\.\d+)?px)$/.test(value)) return unsupported();
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number > max) return unsupported();
  return number;
};
const color = (value: string) => {
  try {
    return normalizeColor(value);
  } catch {
    return unsupported();
  }
};

function parseStyle(raw: string, inherited: Style): Style {
  const style: Style = {
    ...defaults,
    color: inherited.color,
    fontSize: inherited.fontSize,
    fontFamily: inherited.fontFamily,
    fontWeight: inherited.fontWeight,
    textAlign: inherited.textAlign,
    padding: [...defaults.padding],
  };
  if (/[\\@<>{}]|\/\*|url\s*\(|expression\s*\(|var\s*\(/i.test(raw)) unsupported();
  const used = new Set<string>();
  for (const declaration of raw.split(';')) {
    if (!declaration.trim()) continue;
    const colon = declaration.indexOf(':');
    if (colon < 1) unsupported();
    const key = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (used.has(key)) unsupported();
    used.add(key);
    switch (key) {
      case 'width':
      case 'height':
        style[key] = pixels(value);
        if (style[key] < 1) unsupported();
        break;
      case 'background':
      case 'background-color':
        style.fill = color(value);
        break;
      case 'color':
        style.color = color(value);
        break;
      case 'font-size':
        style.fontSize = pixels(value, 1000);
        if (style.fontSize < 1) unsupported();
        break;
      case 'font-family': {
        const font = value.replace(/^(['"])(.*)\1$/, '$2');
        if (!fonts.has(font)) unsupported();
        style.fontFamily = font;
        break;
      }
      case 'font-weight': {
        const weight = value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value);
        if (!Number.isInteger(weight) || weight < 1 || weight > 1000) unsupported();
        style.fontWeight = weight;
        break;
      }
      case 'text-align':
        if (!['left', 'center', 'right'].includes(value)) unsupported();
        style.textAlign = value as Style['textAlign'];
        break;
      case 'border-radius':
        style.radius = pixels(value);
        break;
      case 'opacity': {
        const opacity = Number(value);
        if (!value || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) unsupported();
        style.opacity = opacity;
        break;
      }
      case 'gap':
        style.gap = pixels(value);
        break;
      case 'padding': {
        const parts = value.split(/\s+/).map((part) => pixels(part));
        if (!parts.length || parts.length > 4) unsupported();
        style.padding = [
          parts[0],
          parts[1] ?? parts[0],
          parts[2] ?? parts[0],
          parts[3] ?? parts[1] ?? parts[0],
        ];
        break;
      }
      case 'padding-top':
      case 'padding-right':
      case 'padding-bottom':
      case 'padding-left':
        style.padding[
          ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].indexOf(key)
        ] = pixels(value);
        break;
      case 'display':
        if (value !== 'flex' && value !== 'block') unsupported();
        style.flex = value === 'flex';
        break;
      case 'flex-direction':
        if (!['row', 'column'].includes(value)) unsupported();
        style.row = value === 'row';
        break;
      case 'align-items': {
        const align = value.replace('flex-', '');
        if (!['start', 'center', 'end', 'stretch'].includes(align)) unsupported();
        style.align = align as Style['align'];
        break;
      }
      case 'justify-content': {
        const justify = value.replace('flex-', '');
        if (!['start', 'center', 'end', 'space-between'].includes(justify)) unsupported();
        style.justify = justify as Style['justify'];
        break;
      }
      case 'border': {
        const match = /^(\d+(?:\.\d+)?px|0) solid (.+)$/.exec(value);
        if (!match) unsupported();
        style.strokeWidth = pixels(match![1], 1000);
        style.stroke = color(match![2]);
        break;
      }
      case 'box-sizing':
        if (value !== 'border-box') unsupported();
        break;
      default:
        unsupported();
    }
  }
  if (
    (used.has('flex-direction') ||
      used.has('align-items') ||
      used.has('justify-content') ||
      used.has('gap')) &&
    !/display\s*:\s*flex\s*(?:;|$)/i.test(raw)
  )
    unsupported();
  if (!used.has('flex-direction') && /display\s*:\s*flex\s*(?:;|$)/i.test(raw)) style.row = true;
  return style;
}

function measure(box: Box, availableWidth: number) {
  const style = box.style;
  box.width = style.width ?? Math.max(1, availableWidth);
  const [top, right, bottom, left] = style.padding;
  const innerWidth = Math.max(1, box.width - left - right);
  if (box.text !== undefined) {
    const perLine = Math.max(1, Math.floor(innerWidth / (style.fontSize * 0.58)));
    const lines = box.text
      .split('\n')
      .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
    box.height = style.height ?? Math.max(1, lines * style.fontSize * 1.2 + top + bottom);
    return;
  }
  const gapTotal = style.gap * Math.max(0, box.children.length - 1);
  const fixed = box.children.reduce((sum, child) => sum + (child.style.width ?? 0), 0);
  const automatic = box.children.filter((child) => child.style.width === undefined).length;
  const share = Math.max(1, (innerWidth - fixed - gapTotal) / Math.max(1, automatic));
  for (const child of box.children) measure(child, style.row ? share : innerWidth);
  const contentHeight = style.row
    ? Math.max(0, ...box.children.map((child) => child.height))
    : box.children.reduce((sum, child) => sum + child.height, 0) + gapTotal;
  box.height = style.height ?? Math.max(1, contentHeight + top + bottom);
  if (box.height > 100_000) throw new CommandError('LIMIT_EXCEEDED');
  const innerHeight = Math.max(1, box.height - top - bottom);
  const occupied =
    box.children.reduce((sum, child) => sum + (style.row ? child.width : child.height), 0) +
    gapTotal;
  const spare = Math.max(0, (style.row ? innerWidth : innerHeight) - occupied);
  const gap =
    style.gap +
    (style.justify === 'space-between' && box.children.length > 1
      ? spare / (box.children.length - 1)
      : 0);
  let position = style.justify === 'center' ? spare / 2 : style.justify === 'end' ? spare : 0;
  for (const child of box.children) {
    const crossSpace = Math.max(
      0,
      style.row ? innerHeight - child.height : innerWidth - child.width,
    );
    const cross =
      style.align === 'center' ? crossSpace / 2 : style.align === 'end' ? crossSpace : 0;
    if (style.row && style.align === 'stretch' && child.style.height === undefined)
      child.height = innerHeight;
    child.x = left + (style.row ? position : cross);
    child.y = top + (style.row ? cross : position);
    position += (style.row ? child.width : child.height) + gap;
  }
}

export function htmlToNodes(args: ToolArguments['write_html']): DesignNode[] {
  if (typeof document === 'undefined') throw new CommandError('NOT_READY');
  if (/<\s*!|<\s*\?/.test(args.html)) unsupported();
  const template = document.createElement('template');
  template.innerHTML = args.html;
  let count = 0;
  const textBox = (text: string, inherited: Style): Box => ({
    label: 'Text',
    style: {
      ...defaults,
      color: inherited.color,
      fontSize: inherited.fontSize,
      fontFamily: inherited.fontFamily,
      fontWeight: inherited.fontWeight,
      textAlign: inherited.textAlign,
    },
    text,
    children: [],
    width: 0,
    height: 0,
    x: 0,
    y: 0,
  });
  const parse = (element: Element, inherited: Style, depth: number): Box => {
    if (++count > 200 || depth > 20) throw new CommandError('LIMIT_EXCEEDED');
    const tag = element.localName;
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !tags.has(tag) || tag === 'br')
      unsupported();
    for (const attribute of element.attributes)
      if (!['style', 'data-name', 'layer-name'].includes(attribute.name)) unsupported();
    const style = parseStyle(element.getAttribute('style') ?? '', {
      ...inherited,
      fontWeight: tag === 'strong' || /^h[1-6]$/.test(tag) ? 700 : inherited.fontWeight,
      fontSize: /^h[1-6]$/.test(tag)
        ? [32, 28, 24, 20, 18, 16][Number(tag[1]) - 1]
        : inherited.fontSize,
    });
    const box: Box = {
      label: element.getAttribute('layer-name') || element.getAttribute('data-name') || tag,
      style,
      children: [],
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    };
    if (box.label.length > 256) unsupported();
    const hasContainers = [...element.children].some((child) => child.localName !== 'br');
    if (
      textTags.has(tag) &&
      !hasContainers &&
      style.padding.every((value) => value === 0) &&
      !style.fill &&
      !style.strokeWidth
    ) {
      box.text = [...element.childNodes]
        .map((child) => {
          if (child.nodeType === 3) return child.textContent?.replace(/\s+/g, ' ') ?? '';
          if (
            child.nodeType === 1 &&
            (child as Element).localName === 'br' &&
            !(child as Element).attributes.length
          )
            return '\n';
          return unsupported();
        })
        .join('')
        .trim();
      return box;
    }
    let text = '';
    const flushText = () => {
      if (text.trim()) box.children.push(textBox(text.trim(), style));
      text = '';
    };
    for (const child of element.childNodes) {
      if (child.nodeType === 3) {
        text += child.textContent?.replace(/\s+/g, ' ') ?? '';
        continue;
      }
      if (child.nodeType !== 1) unsupported();
      const nested = child as Element;
      if (nested.localName === 'br') {
        if (nested.attributes.length) unsupported();
        text += '\n';
        continue;
      }
      flushText();
      box.children.push(parse(nested, style, depth + 1));
    }
    flushText();
    return box;
  };
  const root: Box = {
    label: args.name,
    style: { ...defaults, width: args.width },
    children: [],
    width: 0,
    height: 0,
    x: args.x,
    y: args.y,
  };
  for (const child of template.content.childNodes) {
    if (child.nodeType === 3) {
      if (child.textContent?.trim())
        root.children.push(textBox(child.textContent.trim(), defaults));
    } else if (child.nodeType === 1) root.children.push(parse(child as Element, defaults, 1));
    else unsupported();
  }
  if (!root.children.length) unsupported();
  measure(root, args.width);
  const nodes: DesignNode[] = [];
  const emit = (box: Box, parentId: string | null) => {
    if (nodes.length >= 400) throw new CommandError('LIMIT_EXCEEDED');
    const style = box.style;
    const node = createNode(box.text === undefined ? 'frame' : 'text', {
      name: box.label,
      parentId,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      fill: box.text === undefined ? (style.fill ?? 'transparent') : style.color,
      radius: style.radius,
      opacity: style.opacity,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      ...(args.mode && style.flex && box.text === undefined
        ? {
            layout: {
              direction: style.row ? ('row' as const) : ('column' as const),
              gap: style.gap,
              paddingTop: style.padding[0],
              paddingRight: style.padding[1],
              paddingBottom: style.padding[2],
              paddingLeft: style.padding[3],
              align: style.align,
              justify: style.justify,
            },
          }
        : {}),
      ...(box.text === undefined
        ? {}
        : {
            text: box.text,
            fontSize: style.fontSize,
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            textAlign: style.textAlign,
          }),
    });
    nodes.push(node);
    for (const child of box.children) emit(child, node.id);
  };
  emit(root, args.parentId);
  return nodes;
}
