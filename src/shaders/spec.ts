import {
  meshGradientFragmentShader, grainGradientFragmentShader, liquidMetalFragmentShader,
  wavesFragmentShader, dotOrbitFragmentShader, smokeRingFragmentShader,
  staticMeshGradientFragmentShader, staticRadialGradientFragmentShader, ditheringFragmentShader,
  dotGridFragmentShader, warpFragmentShader, spiralFragmentShader, swirlFragmentShader,
  neuroNoiseFragmentShader, perlinNoiseFragmentShader, simplexNoiseFragmentShader,
  voronoiFragmentShader, pulsingBorderFragmentShader, metaballsFragmentShader,
  colorPanelsFragmentShader, godRaysFragmentShader, paperTextureFragmentShader,
  flutedGlassFragmentShader, waterFragmentShader, imageDitheringFragmentShader,
  halftoneDotsFragmentShader, halftoneCmykFragmentShader, lensDistortionFragmentShader,
  heatmapFragmentShader, gemSmokeFragmentShader, getShaderColorFromString,
} from '@paper-design/shaders';
import { validateShaderConfig } from '../../desktop/persistence/validation.mjs';
import type { ShaderConfig, ShaderKind } from '../types';
import { shaderDefinition } from './schema.mjs';

const FRAGMENTS: Record<ShaderKind, string> = {
  'mesh-gradient': meshGradientFragmentShader,
  'grain-gradient': grainGradientFragmentShader,
  'liquid-metal': liquidMetalFragmentShader,
  waves: wavesFragmentShader,
  'dot-orbit': dotOrbitFragmentShader,
  smoke: smokeRingFragmentShader,
  'smoke-ring': smokeRingFragmentShader,
  'static-mesh-gradient': staticMeshGradientFragmentShader,
  'static-radial-gradient': staticRadialGradientFragmentShader,
  dithering: ditheringFragmentShader,
  'dot-grid': dotGridFragmentShader,
  warp: warpFragmentShader,
  spiral: spiralFragmentShader,
  swirl: swirlFragmentShader,
  'neuro-noise': neuroNoiseFragmentShader,
  'perlin-noise': perlinNoiseFragmentShader,
  'simplex-noise': simplexNoiseFragmentShader,
  voronoi: voronoiFragmentShader,
  'pulsing-border': pulsingBorderFragmentShader,
  metaballs: metaballsFragmentShader,
  'color-panels': colorPanelsFragmentShader,
  'god-rays': godRaysFragmentShader,
  'paper-texture': paperTextureFragmentShader,
  'fluted-glass': flutedGlassFragmentShader,
  water: waterFragmentShader,
  'image-dithering': imageDitheringFragmentShader,
  'halftone-dots': halftoneDotsFragmentShader,
  'halftone-cmyk': halftoneCmykFragmentShader,
  'lens-distortion': lensDistortionFragmentShader,
  heatmap: heatmapFragmentShader,
  'gem-smoke': gemSmokeFragmentShader,
};

export interface PaperShaderSpec {
  kind: ShaderKind;
  fragmentShader: string;
  uniforms: Record<string, number | boolean | number[] | number[][]>;
  textures: Partial<Record<'u_image' | 'u_noiseTexture', 'source' | 'empty' | 'noise'>>;
  mipmaps: string[];
}

export function getPaperShaderSpec(input: ShaderConfig): PaperShaderSpec {
  const config = validateShaderConfig(input);
  const definition = shaderDefinition(config.kind)!;
  const kind = config.kind === 'smoke-ring' ? 'smoke' : config.kind;
  const colors = config.colors.map((color) => getShaderColorFromString(color));
  const uniforms: PaperShaderSpec['uniforms'] = {
    u_fit: ['waves', 'dot-orbit', 'dot-grid', 'warp', 'spiral', 'neuro-noise', 'perlin-noise', 'simplex-noise', 'voronoi'].includes(kind) ? 0 : 2,
    u_scale: config.scale,
    u_rotation: kind === 'waves' ? 90 : 0,
    u_originX: 0.5, u_originY: 0.5, u_offsetX: 0, u_offsetY: 0,
    u_worldWidth: 0, u_worldHeight: 0,
  };
  for (const [key, parameter] of Object.entries(definition.parameters))
    uniforms[`u_${key}`] = config.parameters?.[key] ?? parameter.default;

  const textures: PaperShaderSpec['textures'] = {};
  const fragmentShader = FRAGMENTS[kind];
  if (fragmentShader.includes('uniform sampler2D u_noiseTexture')) textures.u_noiseTexture = 'noise';
  if (definition.supportsImage) {
    textures.u_image = !config.source && ['liquid-metal', 'gem-smoke'].includes(kind) ? 'empty' : 'source';
    uniforms.u_fit = definition.category === 'logo' ? 1 : 2;
  }
  const palette = () => Object.assign(uniforms, {
    u_colorBack: colors[0], u_colors: colors.slice(1), u_colorsCount: colors.length - 1,
  });
  const fullPalette = () => Object.assign(uniforms, { u_colors: colors, u_colorsCount: colors.length });
  const pair = () => Object.assign(uniforms, { u_colorBack: colors[0], u_colorFront: colors[1] });
  switch (kind) {
    case 'mesh-gradient':
      fullPalette(); uniforms.u_distortion = config.detail; break;
    case 'grain-gradient':
      palette(); uniforms.u_noise = config.detail; break;
    case 'liquid-metal':
      Object.assign(uniforms, { u_colorBack: colors[0], u_colorTint: colors[1], u_isImage: !!config.source, u_distortion: config.detail }); break;
    case 'waves':
      pair(); uniforms.u_amplitude = config.detail; break;
    case 'dot-orbit':
      palette(); uniforms.u_size = 0.1 + config.detail * 0.9; break;
    case 'smoke':
      palette(); uniforms.u_noiseScale = 0.5 + config.detail * 4.5; break;
    case 'static-mesh-gradient':
      fullPalette(); uniforms.u_mixing = config.detail; break;
    case 'static-radial-gradient':
      palette(); uniforms.u_distortion = config.detail; break;
    case 'dithering':
      pair(); uniforms.u_pxSize = 0.5 + config.detail * 19.5; break;
    case 'dot-grid':
      Object.assign(uniforms, { u_colorBack: colors[0], u_colorFill: colors[1], u_colorStroke: colors[2] ?? colors[1], u_dotSize: 1 + config.detail * 99 }); break;
    case 'warp':
      fullPalette(); uniforms.u_distortion = config.detail; break;
    case 'spiral':
      pair(); uniforms.u_distortion = config.detail; break;
    case 'swirl':
      palette(); uniforms.u_twist = config.detail; break;
    case 'neuro-noise':
      Object.assign(uniforms, { u_colorBack: colors[0], u_colorMid: colors[1], u_colorFront: colors[2] ?? colors[1], u_brightness: config.detail }); break;
    case 'perlin-noise':
      pair(); uniforms.u_persistence = 0.3 + config.detail * 0.7; break;
    case 'simplex-noise':
      fullPalette(); uniforms.u_softness = config.detail; break;
    case 'voronoi':
      Object.assign(uniforms, { u_colors: colors.slice(1), u_colorsCount: colors.length - 1, u_colorGap: colors[0], u_colorGlow: colors[1], u_distortion: config.detail * 0.5 }); break;
    case 'pulsing-border':
      palette(); uniforms.u_thickness = config.detail; break;
    case 'metaballs':
      palette(); uniforms.u_size = config.detail; break;
    case 'color-panels':
      palette(); uniforms.u_density = 0.25 + config.detail * 6.75; break;
    case 'god-rays':
      palette(); Object.assign(uniforms, { u_colorBloom: colors[1], u_density: config.detail }); break;
    case 'paper-texture':
      Object.assign(uniforms, { u_isImage: true, u_colorBack: colors[0], u_colorPaper: colors[1], u_colorShadow: colors[2] ?? colors[0], u_roughness: config.detail }); break;
    case 'fluted-glass':
      Object.assign(uniforms, { u_colorBack: colors[0], u_colorShadow: colors[1], u_colorHighlight: colors[2] ?? colors[1], u_distortion: config.detail }); break;
    case 'water':
      Object.assign(uniforms, { u_colorBack: colors[0], u_colorHighlight: colors[1], u_waves: config.detail }); break;
    case 'image-dithering':
      pair(); Object.assign(uniforms, { u_colorHighlight: colors[2] ?? colors[1], u_pxSize: 0.5 + config.detail * 19.5 }); break;
    case 'halftone-dots':
      pair(); uniforms.u_size = config.detail; break;
    case 'halftone-cmyk':
      Object.assign(uniforms, { u_colorBack: colors[0], u_colorC: colors[1], u_colorM: colors[2] ?? colors[1], u_colorY: colors[3] ?? colors[1], u_colorK: colors[4] ?? colors[1], u_size: config.detail }); break;
    case 'lens-distortion':
      uniforms.u_spread = config.detail; break;
    case 'heatmap':
      palette(); uniforms.u_contour = config.detail; break;
    case 'gem-smoke':
      palette(); Object.assign(uniforms, { u_colorInner: colors[1], u_innerDistortion: config.detail, u_isImage: !!config.source }); break;
  }
  return { kind: config.kind, fragmentShader, uniforms, textures, mipmaps: textures.u_image ? ['u_image'] : [] };
}