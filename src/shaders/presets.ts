import type { ShaderConfig, ShaderKind } from '../types';
import { shaderDefinition } from './schema.mjs';

export interface ShaderPreset {
  id: ShaderKind;
  name: string;
  description: string;
  config: ShaderConfig;
  category: 'effect' | 'image-filter' | 'logo';
  animated: boolean;
  motion: 'animated' | 'static';
  supportsImage: boolean;
}

const featured = [
  {
    id: 'mesh-gradient',
    name: 'Mesh gradient',
    description: 'Silky fields of color, flowing into one another.',
    config: {
      kind: 'mesh-gradient',
      colors: ['#fae8ff', '#6858ed', '#ff8dbd', '#ffe1a8'],
      speed: 0.45,
      scale: 1,
      detail: 0.8,
      paused: false,
    },
  },
  {
    id: 'grain-gradient',
    name: 'Grain gradient',
    description: 'Soft color, tactile grain, a little atmosphere.',
    config: {
      kind: 'grain-gradient',
      colors: ['#100e24', '#ff714b', '#f5c8a6', '#7762ff'],
      speed: 0.35,
      scale: 1,
      detail: 0.35,
      paused: false,
    },
  },
  {
    id: 'liquid-metal',
    name: 'Liquid metal',
    description: 'Sculpted chrome with shifting, fluid reflections.',
    config: {
      kind: 'liquid-metal',
      colors: ['#aaaab8', '#e8e9ff'],
      speed: 0.5,
      scale: 1,
      detail: 0.3,
      paused: false,
    },
  },
  {
    id: 'waves',
    name: 'Waves',
    description: 'Graphic ribbons and flowing lines. A static pattern.',
    config: {
      kind: 'waves',
      colors: ['#fd785d', '#fff4dc'],
      speed: 0,
      scale: 2,
      detail: 0.55,
      paused: true,
    },
  },
  {
    id: 'dot-orbit',
    name: 'Dot orbit',
    description: 'Playful, luminous dots in a slow orbital dance.',
    config: {
      kind: 'dot-orbit',
      colors: ['#15132c', '#b4a3ff', '#ff91b9', '#ffce79'],
      speed: 0.5,
      scale: 1.25,
      detail: 0.65,
      paused: false,
    },
  },
  {
    id: 'smoke',
    name: 'Smoke ring',
    description: 'An ethereal halo of light and turbulent color.',
    config: {
      kind: 'smoke',
      colors: ['#100e20', '#aa91ff', '#ffd4e2', '#82caff'],
      speed: 0.4,
      scale: 1.1,
      detail: 0.5,
      paused: false,
    },
  },
] satisfies Omit<ShaderPreset, 'category' | 'animated' | 'motion' | 'supportsImage'>[];

function withMetadata(preset: Omit<ShaderPreset, 'category' | 'animated' | 'motion' | 'supportsImage'>): ShaderPreset {
  const definition = shaderDefinition(preset.id)!;
  return {
    ...preset,
    category: definition.category,
    animated: definition.animated,
    motion: definition.animated ? 'animated' : 'static',
    supportsImage: definition.supportsImage,
  };
}

export const SHADER_PRESETS: readonly ShaderPreset[] = featured.map(withMetadata);

function preset(
  id: ShaderKind,
  name: string,
  description: string,
  colors: string[],
  detail = 0.5,
  scale = 1,
): ShaderPreset {
  const animated = shaderDefinition(id)!.animated;
  return withMetadata({
    id, name, description,
    config: { kind: id, colors, speed: animated ? 0.4 : 0, scale, detail, paused: !animated },
  });
}

export const SHADER_CATALOG: readonly ShaderPreset[] = [
  ...SHADER_PRESETS,
  preset('static-mesh-gradient', 'Static mesh gradient', 'Sculpted color fields with adjustable placement and grain.', ['#ffbea8', '#e65591', '#634dd2', '#e8ddff'], 0.65),
  preset('static-radial-gradient', 'Static radial gradient', 'Layered radial color with a movable focal point.', ['#271b50', '#ef8db9', '#ffd4a0', '#7755dd'], 0.3),
  preset('dithering', 'Dithering', 'Animated patterns translated into crisp, pixel-sized ink.', ['#18162b', '#d9ef91'], 0.15),
  preset('dot-grid', 'Dot grid', 'Precise circles, diamonds, squares, or triangles.', ['#ece8da', '#3e5472', '#bac7d4'], 0.15),
  preset('warp', 'Warp', 'Color stripes folded into flowing, marbled currents.', ['#312666', '#ff954a', '#f4c5f1', '#9abaff'], 0.65),
  preset('spiral', 'Spiral', 'A winding graphic spiral with organic distortion.', ['#f6dfba', '#df543d'], 0.2),
  preset('swirl', 'Swirl', 'Bands of color pulled into a twisting vortex.', ['#1d1942', '#f789a7', '#8b83ff', '#ffe0a0'], 0.45, 0.45),
  preset('neuro-noise', 'Neuro noise', 'An electric web of luminous, fluid intersections.', ['#071e29', '#338e99', '#c7ffb3'], 0.8, 0.3),
  preset('perlin-noise', 'Perlin noise', 'Classic organic noise with layered, evolving detail.', ['#172a47', '#bad6ed'], 0.5),
  preset('simplex-noise', 'Simplex noise', 'Smooth, stepped fields of moving color.', ['#30473d', '#a6b876', '#f5d79e', '#cb7044'], 0.6),
  preset('voronoi', 'Voronoi', 'Shifting stained-glass cells with glowing edges.', ['#172334', '#6699bc', '#c7e5ed', '#93b5ae'], 0.4),
  preset('pulsing-border', 'Pulsing border', 'A glowing contour with drifting color and smoke.', ['#131125', '#bd86ff', '#ffa1b6', '#87c8ff'], 0.25),
  preset('metaballs', 'Metaballs', 'Gooey, colorful blobs merge and separate.', ['#e8f0ed', '#63988c', '#bad3b7', '#e9b77c'], 0.55),
  preset('color-panels', 'Color panels', 'Translucent planes rotating through colored light.', ['#16182f', '#d390dc', '#789cdc', '#e3b28c'], 0.45),
  preset('god-rays', 'God rays', 'Luminous rays, soft bloom, and a glowing center.', ['#151c32', '#cca0f0', '#8eaefa', '#f9d5ab'], 0.6),
  preset('paper-texture', 'Paper texture', 'Layered fibers and folds printed over an image.', ['#e9dfcb', '#f7eedb', '#785f53'], 0.5),
  preset('fluted-glass', 'Fluted glass', 'Ribbed glass refracts a locally embedded image.', ['#242637', '#211c3a', '#f6e9ef'], 0.55),
  preset('water', 'Water', 'Living caustics ripple across your image.', ['#163a50', '#bfedf2'], 0.4),
  preset('image-dithering', 'Image dithering', 'Turn an image into a limited-palette pixel print.', ['#17273e', '#e9bda6', '#f4ebd8'], 0.15),
  preset('halftone-dots', 'Halftone dots', 'Classic print dots shaped by your image luminance.', ['#f5e7c7', '#343044'], 0.3),
  preset('halftone-cmyk', 'Halftone CMYK', 'Four-color printing with separately editable inks.', ['#fff5dc', '#00a5c8', '#df407a', '#f5d536', '#26202e'], 0.3),
  preset('lens-distortion', 'Lens distortion', 'Chromatic dispersion and curved lens refraction.', ['#211b34', '#e8c6ad'], 0.35),
  preset('heatmap', 'Heatmap', 'A heated wave of color flowing through your logo.', ['#171129', '#572587', '#e94c56', '#ffb44f', '#fff0ae'], 0.65, 1.3),
  preset('gem-smoke', 'Gem smoke', 'Glassy logo contours filled with iridescent smoke.', ['#13172b', '#8c80e6', '#e7a3c4', '#a3d7ef'], 0.5),
];

export const SHADER_DETAIL_LABELS = Object.fromEntries([
  ...SHADER_CATALOG.map(({ id }) => [id, shaderDefinition(id)!.detailLabel]),
  ['smoke-ring', shaderDefinition('smoke')!.detailLabel],
]) as Record<ShaderKind, string>;

export function createShaderConfig(kind: ShaderKind = 'mesh-gradient'): ShaderConfig {
  const preset = SHADER_CATALOG.find((item) => item.id === (kind === 'smoke-ring' ? 'smoke' : kind));
  if (!preset) throw new Error('Unsupported Paper shader preset.');
  return { ...preset.config, kind, colors: [...preset.config.colors] };
}
