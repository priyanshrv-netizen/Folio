const range = (label, min, max, value, step = 0.01) => ({
  type: 'number', label, min, max, default: value, step,
});
const unit = (label, value) => range(label, 0, 1, value);
const toggle = (label, value) => ({ type: 'boolean', label, default: value });
const choice = (label, value, options) => ({
  ...range(label, Math.min(...options.map((item) => item[0])), Math.max(...options.map((item) => item[0])), value, 1),
  options: options.map(([value, label]) => ({ value, label })),
});
const grain = { grainMixer: unit('Grain distortion', 0), grainOverlay: unit('Grain overlay', 0) };
const margins = {
  marginLeft: unit('Left margin', 0), marginRight: unit('Right margin', 0),
  marginTop: unit('Top margin', 0), marginBottom: unit('Bottom margin', 0),
};
const shapeOptions = [[0, 'Canvas'], [1, 'Circle'], [2, 'Daisy'], [3, 'Diamond'], [4, 'Metaballs']];
const ditherOptions = [[1, 'Random'], [2, 'Bayer 2 × 2'], [3, 'Bayer 4 × 4'], [4, 'Bayer 8 × 8']];
const definition = (category, animated, maxColors, detailLabel, parameters, extra = {}) => ({
  category, animated, maxColors, detailLabel, parameters,
  supportsImage: category !== 'effect', ...extra,
});

export const SHADER_DEFINITIONS = {
  'mesh-gradient': definition('effect', true, 6, 'Distortion', {
    swirl: unit('Swirl', 0.35), ...grain,
  }, { palette: 'all' }),
  'grain-gradient': definition('effect', true, 6, 'Grain', {
    softness: unit('Softness', 0.7), intensity: unit('Intensity', 0.5),
    shape: choice('Shape', 4, [[1, 'Wave'], [2, 'Dots'], [3, 'Truchet'], [4, 'Corners'], [5, 'Ripple'], [6, 'Blob'], [7, 'Sphere']]),
  }),
  'liquid-metal': definition('logo', true, 2, 'Distortion', {
    shape: choice('Shape without image', 0, shapeOptions), contour: unit('Contour', 0.4),
    softness: unit('Softness', 0.08), repetition: range('Repetition', 1, 10, 1.5),
    shiftRed: range('Red shift', -1, 1, 0.25), shiftBlue: range('Blue shift', -1, 1, 0.25),
    angle: range('Flow angle', 0, 360, 70, 1),
  }, { colorLabels: ['Background', 'Metal tint'] }),
  waves: definition('effect', false, 2, 'Amplitude', {
    shape: range('Wave shape', 0, 3, 3), frequency: range('Frequency', 0, 2, 0.25),
    spacing: range('Spacing', 0, 2, 1.17), proportion: unit('Proportion', 0.5), softness: unit('Softness', 0),
  }, { colorLabels: ['Background', 'Lines'] }),
  'dot-orbit': definition('effect', true, 6, 'Dot size', {
    sizeRange: unit('Size variation', 0.35), spreading: unit('Orbit spread', 1),
    stepsPerColor: range('Color steps', 1, 4, 3, 1),
  }),
  smoke: definition('effect', true, 6, 'Turbulence', {
    noiseIterations: range('Noise layers', 1, 8, 6, 1), radius: unit('Ring radius', 0.3),
    thickness: range('Ring thickness', 0.01, 1, 0.65), innerShape: range('Inner fill', 0, 4, 0.9),
  }),
  'static-mesh-gradient': definition('effect', false, 6, 'Color mixing', {
    positions: range('Color placement', 0, 100, 13, 1), waveX: unit('Horizontal warp', 0.35),
    waveY: unit('Vertical warp', 0.6), waveXShift: unit('Horizontal phase', 0.1),
    waveYShift: unit('Vertical phase', 0.3), ...grain,
  }, { palette: 'all' }),
  'static-radial-gradient': definition('effect', false, 6, 'Distortion', {
    radius: range('Radius', 0.05, 3, 1.2), focalDistance: range('Focal distance', 0, 3, 0.2),
    focalAngle: range('Focal angle', 0, 360, 45, 1), falloff: range('Falloff', -1, 1, 0),
    mixing: unit('Color mixing', 0.75), distortionShift: range('Distortion shift', -1, 1, 0),
    distortionFreq: range('Distortion frequency', 0, 20, 4), ...grain,
  }),
  dithering: definition('effect', true, 2, 'Pixel size', {
    shape: choice('Pattern', 2, [[1, 'Simplex'], [2, 'Warp'], [3, 'Dots'], [4, 'Wave'], [5, 'Ripple'], [6, 'Swirl'], [7, 'Sphere']]),
    type: choice('Dither type', 4, ditherOptions),
  }, { colorLabels: ['Background', 'Ink'] }),
  'dot-grid': definition('effect', false, 3, 'Dot size', {
    gapX: range('Horizontal gap', 2, 500, 36, 1), gapY: range('Vertical gap', 2, 500, 36, 1),
    strokeWidth: range('Outline width', 0, 50, 1), sizeRange: unit('Size variation', 0),
    opacityRange: unit('Opacity variation', 0),
    shape: choice('Dot shape', 0, [[0, 'Circle'], [1, 'Diamond'], [2, 'Square'], [3, 'Triangle']]),
  }, { colorLabels: ['Background', 'Dot fill', 'Dot outline'] }),
  warp: definition('effect', true, 6, 'Distortion', {
    proportion: unit('Proportion', 0.5), softness: unit('Softness', 0.7),
    shape: choice('Base pattern', 1, [[0, 'Checks'], [1, 'Stripes'], [2, 'Split edge']]),
    shapeScale: unit('Pattern size', 0.35), swirl: unit('Swirl', 0.6),
    swirlIterations: range('Swirl layers', 2, 20, 8, 1),
  }, { palette: 'all' }),
  spiral: definition('effect', true, 2, 'Distortion', {
    density: unit('Perspective', 0.5), strokeWidth: unit('Stroke width', 0.4),
    strokeTaper: unit('Stroke taper', 0.2), strokeCap: unit('Center width', 0.4),
    noise: unit('Noise', 0.1), noiseFrequency: unit('Noise frequency', 0.35), softness: unit('Softness', 0.05),
  }, { colorLabels: ['Background', 'Spiral'] }),
  swirl: definition('effect', true, 6, 'Twist', {
    bandCount: range('Bands', 0, 15, 5, 1), center: unit('Center gap', 0.2),
    proportion: unit('Proportion', 0.5), softness: unit('Softness', 0.3),
    noise: unit('Noise', 0.1), noiseFrequency: unit('Noise frequency', 0.3),
  }),
  'neuro-noise': definition('effect', true, 3, 'Brightness', {
    contrast: unit('Contrast', 0.3),
  }, { colorLabels: ['Background', 'Midtone', 'Highlights'] }),
  'perlin-noise': definition('effect', true, 2, 'Roughness', {
    proportion: unit('Proportion', 0.5), softness: unit('Softness', 0.5),
    octaveCount: range('Noise octaves', 1, 8, 4, 1), lacunarity: range('Lacunarity', 1.5, 10, 2),
  }, { colorLabels: ['Background', 'Noise'] }),
  'simplex-noise': definition('effect', true, 6, 'Softness', {
    stepsPerColor: range('Color steps', 1, 10, 3, 1),
  }, { palette: 'all' }),
  voronoi: definition('effect', true, 6, 'Cell distortion', {
    stepsPerColor: range('Color steps', 1, 3, 2, 1), gap: range('Cell gap', 0, 0.1, 0.025, 0.001),
    glow: unit('Inner glow', 0.4),
  }, { colorLabels: ['Cell edges', 'Cell 1', 'Cell 2', 'Cell 3', 'Cell 4', 'Cell 5'] }),
  'pulsing-border': definition('effect', true, 6, 'Thickness', {
    roundness: unit('Roundness', 0.35), softness: unit('Softness', 0.65), ...margins,
    aspectRatio: choice('Aspect ratio', 0, [[0, 'Automatic'], [1, 'Square']]),
    intensity: unit('Intensity', 0.7), bloom: unit('Bloom', 0.5), spots: range('Spots per color', 1, 4, 2, 1),
    spotSize: unit('Spot size', 0.45), pulse: unit('Pulse', 0.4), smoke: unit('Smoke', 0.25), smokeSize: unit('Smoke size', 0.5),
  }),
  metaballs: definition('effect', true, 6, 'Blob size', {
    count: range('Blob count', 1, 20, 7, 1),
  }),
  'color-panels': definition('effect', true, 6, 'Panel density', {
    angle1: range('First skew', -1, 1, 0.3), angle2: range('Second skew', -1, 1, -0.2),
    length: range('Panel length', 0, 3, 1.2), edges: toggle('Highlighted edges', true),
    blur: range('Edge blur', 0, 0.5, 0.15), fadeIn: unit('Inner fade', 0.3),
    fadeOut: unit('Outer fade', 0.3), gradient: unit('Panel gradient', 0.7),
  }),
  'god-rays': definition('effect', true, 6, 'Ray density', {
    spotty: unit('Spottiness', 0.3), midSize: unit('Center size', 0.3),
    midIntensity: unit('Center glow', 0.65), intensity: unit('Intensity', 0.75), bloom: unit('Bloom', 0.4),
  }),
  'paper-texture': definition('image-filter', false, 3, 'Roughness', {
    blending: unit('Image blending', 0.65), distortion: range('Image distortion', -1, 1, 0.15),
    clip: toggle('Clip to image', false), angle: range('Light angle', 0, 360, 45, 1), seed: range('Texture seed', 0, 1000, 4, 1),
    roughnessSize: unit('Grain size', 0.4), roughnessRows: unit('Grain rows', 0.25),
    fiber: unit('Fiber', 0.3), fiberSize: unit('Fiber size', 0.5), folds: unit('Folds', 0.25),
    foldSizeX: unit('Horizontal fold size', 0.5), foldSizeY: unit('Vertical fold size', 0.65),
    foldOffsetX: unit('Horizontal fold offset', 0.3), foldOffsetY: unit('Vertical fold offset', 0.4),
    wrinkles: unit('Wrinkles', 0.3), wrinkleSize: unit('Wrinkle size', 0.4),
    crumples: unit('Crumples', 0.25), crumpleCount: range('Crumple count', 2, 15, 6, 1), drops: unit('Speckles', 0.1),
  }, { colorLabels: ['Background', 'Paper', 'Shadows'] }),
  'fluted-glass': definition('image-filter', false, 3, 'Distortion', {
    shadows: unit('Shadows', 0.2), highlights: unit('Highlights', 0.35), size: unit('Flute size', 0.3),
    angle: range('Flute angle', 0, 180, 0, 1), shift: range('Image shift', -1, 1, 0),
    blur: unit('Blur', 0.08), edges: unit('Edge softness', 0.15), ...margins, stretch: unit('Stretch', 0.1),
    distortionShape: choice('Distortion shape', 2, [[1, 'Prism'], [2, 'Lens'], [3, 'Contour'], [4, 'Cascade'], [5, 'Flat']]),
    shape: choice('Glass grid', 1, [[1, 'Lines'], [2, 'Irregular lines'], [3, 'Wave'], [4, 'Zigzag'], [5, 'Pattern']]), ...grain,
  }, { colorLabels: ['Background', 'Shadows', 'Highlights'] }),
  water: definition('image-filter', true, 2, 'Waves', {
    highlights: unit('Highlights', 0.4), layering: unit('Layering', 0.5),
    edges: unit('Edges', 0.5), caustic: unit('Caustics', 0.65), size: range('Ripple size', 0.01, 7, 1.5),
  }, { colorLabels: ['Background', 'Highlights'] }),
  'image-dithering': definition('image-filter', false, 3, 'Pixel size', {
    type: choice('Dither type', 4, ditherOptions), colorSteps: range('Color steps', 1, 7, 3, 1),
    originalColors: toggle('Original image colors', false), inverted: toggle('Invert luminance', false),
  }, { colorLabels: ['Background', 'Ink', 'Highlights'] }),
  'halftone-dots': definition('image-filter', false, 2, 'Grid size', {
    grid: choice('Grid', 1, [[0, 'Square'], [1, 'Hexagonal']]), radius: range('Dot radius', 0, 2, 1),
    contrast: unit('Contrast', 0.7), originalColors: toggle('Original image colors', false),
    inverted: toggle('Invert luminance', false), ...grain, grainSize: unit('Grain size', 0.4),
    type: choice('Dot style', 0, [[0, 'Classic'], [1, 'Gooey'], [2, 'Holes'], [3, 'Soft']]),
  }, { colorLabels: ['Paper', 'Ink'] }),
  'halftone-cmyk': definition('image-filter', false, 5, 'Grid size', {
    contrast: range('Contrast', 0, 2, 1), softness: unit('Softness', 0.1),
    grainSize: unit('Grain size', 0.4), ...grain, gridNoise: unit('Grid noise', 0.05),
    floodC: unit('Cyan flood', 0), floodM: unit('Magenta flood', 0), floodY: unit('Yellow flood', 0), floodK: unit('Black flood', 0),
    gainC: range('Cyan gain', -1, 1, 0), gainM: range('Magenta gain', -1, 1, 0),
    gainY: range('Yellow gain', -1, 1, 0), gainK: range('Black gain', -1, 1, 0),
    type: choice('Dot style', 0, [[0, 'Dots'], [1, 'Ink'], [2, 'Sharp']]),
  }, { colorLabels: ['Paper', 'Cyan', 'Magenta', 'Yellow', 'Black'] }),
  'lens-distortion': definition('image-filter', false, 2, 'Color spread', {
    bias: range('Color bias', -1, 1, 0), angle: range('Spread angle', 0, 360, 25, 1),
    perspective: unit('Perspective', 0.65), count: range('Color samples', 2, 50, 16, 1),
    dispersion: unit('Dispersion', 0.8), dispersionShift: range('Dispersion shift', -1, 1, 0),
    dispersionColor: unit('Hue shift', 0), focusCenter: unit('Center focus', 0.3),
    focusEdges: unit('Edge focus', 0), swirl: range('Swirl', -1, 1, 0.15), noise: unit('Noise', 0),
    noiseFrequency: unit('Noise frequency', 0.3), noiseOffset: unit('Noise offset', 0),
    lensBulge: range('Lens bulge', -1, 1, 0.2), lensCircle: unit('Circular lens', 0), ...grain,
    imageX: range('Image horizontal offset', -1, 1, 0), imageY: range('Image vertical offset', -1, 1, 0),
  }, { palette: 'none' }),
  heatmap: definition('logo', true, 6, 'Contour heat', {
    angle: range('Heat angle', 0, 360, 45, 1), noise: unit('Grain', 0.03),
    innerGlow: unit('Inner glow', 0.65), outerGlow: unit('Outer glow', 0.5),
  }),
  'gem-smoke': definition('logo', true, 6, 'Inner distortion', {
    outerDistortion: unit('Outer distortion', 0.5), outerGlow: unit('Outer glow', 0.6),
    innerGlow: unit('Inner glow', 0.65), offset: range('Smoke offset', -1, 1, 0),
    angle: range('Smoke angle', 0, 360, 0, 1), size: unit('Smoke size', 0.65),
    shape: choice('Shape without image', 2, shapeOptions),
  }),
};

export function shaderDefinition(kind) {
  const id = kind === 'smoke-ring' ? 'smoke' : kind;
  return Object.hasOwn(SHADER_DEFINITIONS, id) ? SHADER_DEFINITIONS[id] : undefined;
}