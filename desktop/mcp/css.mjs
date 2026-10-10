const namedColors = Object.freeze({
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  rebeccapurple: '#663399',
  pink: '#ffc0cb',
  navy: '#000080',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  lime: '#00ff00',
  maroon: '#800000',
  olive: '#808000',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  transparent: 'transparent',
});

export function normalizeColor(input) {
  if (typeof input !== 'string' || input.length > 128) throw new Error('Unsupported CSS color.');
  const value = input.trim().toLowerCase();
  if (Object.hasOwn(namedColors, value)) return namedColors[value];
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/.test(value)) {
    const hex =
      value.length < 6
        ? [...value.slice(1)].map((digit) => digit + digit).join('')
        : value.slice(1);
    return `#${hex.length === 8 && hex.endsWith('ff') ? hex.slice(0, 6) : hex}`;
  }
  const match = /^(rgb|rgba|hsl|hsla)\(([\d.%,\s/+-]+)\)$/.exec(value);
  if (!match) throw new Error('Unsupported CSS color.');
  const parts = match[2].trim().split(/\s*[,/]\s*|\s+/);
  if (parts.length < 3 || parts.length > 4) throw new Error('Unsupported CSS color.');
  const numeric = parts.map((part) => Number(part.replace(/%$/, '')));
  if (numeric.some((number) => !Number.isFinite(number))) throw new Error('Unsupported CSS color.');
  let rgb;
  if (match[1].startsWith('rgb')) {
    rgb = parts.slice(0, 3).map((part, index) => numeric[index] * (part.endsWith('%') ? 2.55 : 1));
    if (rgb.some((number) => number < 0 || number > 255)) throw new Error('Unsupported CSS color.');
  } else {
    if (
      !parts[1].endsWith('%') ||
      !parts[2].endsWith('%') ||
      numeric.slice(1, 3).some((number) => number < 0 || number > 100)
    )
      throw new Error('Unsupported CSS color.');
    const h = (((numeric[0] % 360) + 360) % 360) / 30;
    const s = numeric[1] / 100;
    const l = numeric[2] / 100;
    const a = s * Math.min(l, 1 - l);
    rgb = [0, 8, 4].map(
      (n) => 255 * (l - a * Math.max(-1, Math.min(((n + h) % 12) - 3, 9 - ((n + h) % 12), 1))),
    );
  }
  const alpha = parts.length === 4 ? numeric[3] / (parts[3].endsWith('%') ? 100 : 1) : 1;
  if (alpha < 0 || alpha > 1) throw new Error('Unsupported CSS color.');
  return `#${[...rgb, ...(alpha < 1 ? [alpha * 255] : [])].map((number) => Math.round(number).toString(16).padStart(2, '0')).join('')}`;
}

export function cssPixels(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(value.trim()))
    return Number.parseFloat(value);
  throw new Error('Use a finite pixel value.');
}

export function cssToStyles(input, type = 'frame', currentLayout) {
  const result = {};
  const layoutKeys = [
    'flexDirection',
    'gap',
    'padding',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'alignItems',
    'justifyContent',
  ];
  const hasLayout = input.display === 'flex' || layoutKeys.some((key) => Object.hasOwn(input, key));
  if (hasLayout) {
    if (
      type !== 'frame' ||
      input.display === 'block' ||
      (!currentLayout && input.display !== 'flex')
    )
      throw new Error('Flex layout requires a frame with display:flex.');
    result.layout = {
      direction: 'row',
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      align: 'stretch',
      justify: 'start',
      ...currentLayout,
    };
  }
  for (const [key, value] of Object.entries(input)) {
    if (type !== 'text' && ['fontSize', 'fontWeight', 'fontFamily', 'textAlign'].includes(key))
      throw new Error('Typography applies to text nodes.');
    switch (key) {
      case 'width':
      case 'height':
      case 'fontSize':
        result[key] = cssPixels(value);
        break;
      case 'left':
        result.x = cssPixels(value);
        break;
      case 'top':
        result.y = cssPixels(value);
        break;
      case 'background':
      case 'backgroundColor':
        if (type === 'text') throw new Error('Text nodes do not have a background.');
        result.fill = normalizeColor(value);
        break;
      case 'color':
        if (type !== 'text') throw new Error('Color applies to text nodes.');
        result.fill = normalizeColor(value);
        break;
      case 'borderColor':
        result.stroke = normalizeColor(value);
        break;
      case 'borderWidth':
        result.strokeWidth = cssPixels(value);
        break;
      case 'borderRadius':
        result.radius = cssPixels(value);
        break;
      case 'border': {
        const match = /^(\d+(?:\.\d+)?(?:px)?)\s+solid\s+(.+)$/.exec(String(value));
        if (!match) throw new Error('Use a solid border.');
        result.strokeWidth = cssPixels(match[1]);
        result.stroke = normalizeColor(match[2]);
        break;
      }
      case 'opacity':
        result.opacity = Number(value);
        break;
      case 'fontWeight':
        result.fontWeight = value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value);
        break;
      case 'fontFamily':
        result.fontFamily = String(value).replace(/^(['"])(.*)\1$/, '$2');
        break;
      case 'textAlign':
        result.textAlign = value;
        break;
      case 'visibility':
        if (!['visible', 'hidden'].includes(value)) throw new Error('Unsupported visibility.');
        result.visible = value === 'visible';
        break;
      case 'display':
        if (!['flex', 'block', 'none'].includes(value)) throw new Error('Unsupported display.');
        result.visible = value !== 'none';
        if (value === 'block') result.layout = undefined;
        break;
      case 'flexDirection':
        result.layout.direction = value;
        break;
      case 'gap':
      case 'paddingTop':
      case 'paddingRight':
      case 'paddingBottom':
      case 'paddingLeft':
        result.layout[key] = cssPixels(value);
        break;
      case 'padding': {
        const parts =
          typeof value === 'number' ? [value] : value.trim().split(/\s+/).map(cssPixels);
        if (!parts.length || parts.length > 4) throw new Error('Unsupported padding.');
        [
          result.layout.paddingTop,
          result.layout.paddingRight,
          result.layout.paddingBottom,
          result.layout.paddingLeft,
        ] = [
          parts[0],
          parts[1] ?? parts[0],
          parts[2] ?? parts[0],
          parts[3] ?? parts[1] ?? parts[0],
        ];
        break;
      }
      case 'alignItems':
        result.layout.align = String(value).replace('flex-', '');
        break;
      case 'justifyContent':
        result.layout.justify = String(value).replace('flex-', '');
        break;
      case 'transform': {
        const match = /^rotate\(([-+\d.]+)deg\)$/.exec(String(value));
        if (!match) throw new Error('Only rotation is supported.');
        result.rotation = Number(match[1]);
        break;
      }
      default:
        throw new Error('Unsupported CSS property.');
    }
  }
  return result;
}
