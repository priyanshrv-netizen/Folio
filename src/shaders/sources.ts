import {
  emptyPixel, getShaderNoiseTexture, toProcessedHeatmap, toProcessedLiquidMetal, toProcessedGemSmoke,
} from '@paper-design/shaders';
import { MAX_IMAGE_BYTES, validateShaderSource } from '../../desktop/persistence/validation.mjs';
import type { ShaderConfig } from '../types';
import type { PaperShaderSpec } from './spec';

export const SHADER_SOURCE_MAX_DIMENSION = 1_536;
const demoSources = new Map<string, string>();
const sourceImages = new Map<string, Promise<HTMLImageElement>>();
let noiseImage: Promise<HTMLImageElement> | undefined;
let emptyImage: Promise<HTMLImageElement> | undefined;

export function shaderDemoSource(logo = false): string {
  const key = logo ? 'logo' : 'image';
  const cached = demoSources.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is required to create the local shader demo image.');
  if (logo) {
    context.fillStyle = '#000000';
    context.beginPath();
    for (let point = 0; point < 160; point += 1) {
      const angle = (point / 160) * Math.PI * 2;
      const radius = 138 + Math.cos(angle * 8) * 30;
      const x = 320 + Math.cos(angle) * radius;
      const y = 240 + Math.sin(angle) * radius;
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
    context.globalCompositeOperation = 'destination-out';
    context.beginPath();
    context.arc(320, 240, 54, 0, Math.PI * 2);
    context.fill();
  } else {
    const sky = context.createLinearGradient(0, 0, 560, 480);
    sky.addColorStop(0, '#e2c3ee'); sky.addColorStop(0.45, '#f8b69c'); sky.addColorStop(1, '#4b83a2');
    context.fillStyle = sky;
    context.fillRect(0, 0, 640, 480);
    const sun = context.createRadialGradient(440, 140, 4, 440, 140, 100);
    sun.addColorStop(0, '#fff8ce'); sun.addColorStop(0.9, '#ffdf8f'); sun.addColorStop(1, '#ef9b75');
    context.fillStyle = sun;
    context.beginPath(); context.arc(440, 140, 96, 0, Math.PI * 2); context.fill();
    for (let layer = 0; layer < 4; layer += 1) {
      context.beginPath(); context.moveTo(0, 480);
      for (let x = 0; x <= 640; x += 4)
        context.lineTo(x, 255 + layer * 52 + Math.sin(x / 125 + layer * 0.9) * (62 - layer * 7));
      context.lineTo(640, 480); context.closePath();
      context.fillStyle = ['#a577a6', '#746794', '#465478', '#273b59'][layer];
      context.fill();
    }
  }
  const source = canvas.toDataURL('image/png');
  demoSources.set(key, source);
  canvas.width = canvas.height = 1;
  return source;
}

async function decodeRaster(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = source;
  try {
    await image.decode();
  } catch {
    throw new Error('The shader image could not be decoded. Choose a valid PNG, JPEG, GIF, or WebP.');
  }
  if (!image.naturalWidth || !image.naturalHeight || Math.max(image.naturalWidth, image.naturalHeight) > 8_192 || image.naturalWidth * image.naturalHeight > 32_000_000)
    throw new Error('Shader images must be at most 8192 pixels per side and 32 megapixels.');
  return image;
}

async function boundedRaster(source: string): Promise<HTMLImageElement> {
  const image = await decodeRaster(source);
  const ratio = Math.min(1, SHADER_SOURCE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  if (ratio === 1) return image;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is required to resize shader images.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const result = await decodeRaster(canvas.toDataURL('image/png'));
  canvas.width = canvas.height = 1;
  return result;
}

export async function importShaderSource(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Shader images must be at most 10 MiB.');
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPEG, GIF, or WebP image. SVG and external URLs are not supported.');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image file could not be read.'));
    reader.readAsDataURL(file);
  });
  const image = await boundedRaster(validateShaderSource(source));
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is required to import shader images.');
  context.drawImage(image, 0, 0);
  const normalized = validateShaderSource(canvas.toDataURL('image/png'));
  canvas.width = canvas.height = 1;
  return normalized;
}

async function sourceTexture(config: ShaderConfig): Promise<HTMLImageElement> {
  const source = config.source ?? shaderDemoSource(config.kind === 'heatmap');
  validateShaderSource(source);
  const key = `${config.kind}:${source}`;
  const cached = sourceImages.get(key);
  if (cached) return cached;
  const task = (async () => {
    const image = await boundedRaster(source);
    let processorInput = image.src;
    if (['heatmap', 'liquid-metal', 'gem-smoke'].includes(config.kind)) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.max(image.naturalWidth, image.naturalHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is required to prepare a logo mask.');
      context.drawImage(image, (canvas.width - image.naturalWidth) / 2, (canvas.height - image.naturalHeight) / 2);
      processorInput = canvas.toDataURL('image/png');
      canvas.width = canvas.height = 1;
    }
    let processed: Blob | undefined;
    if (config.kind === 'heatmap') processed = (await toProcessedHeatmap(processorInput)).blob;
    if (config.kind === 'liquid-metal') processed = (await toProcessedLiquidMetal(processorInput)).pngBlob;
    if (config.kind === 'gem-smoke') processed = (await toProcessedGemSmoke(processorInput)).pngBlob;
    if (!processed) return image;
    const url = URL.createObjectURL(processed);
    try {
      return await decodeRaster(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  })().catch((cause) => {
    sourceImages.delete(key);
    throw cause;
  });
  sourceImages.set(key, task);
  if (sourceImages.size > 12) sourceImages.delete(sourceImages.keys().next().value!);
  return task;
}

export async function paperShaderTextures(config: ShaderConfig, spec: PaperShaderSpec): Promise<Record<string, HTMLImageElement>> {
  const images: Record<string, HTMLImageElement> = {};
  if (spec.textures.u_noiseTexture) {
    noiseImage ??= (async () => {
      const noise = getShaderNoiseTexture();
      if (!noise) throw new Error('Paper shaders need a browser with WebGL2.');
      await noise.decode();
      return noise;
    })();
    images.u_noiseTexture = await noiseImage;
  }
  if (spec.textures.u_image === 'empty') {
    emptyImage ??= decodeRaster(emptyPixel);
    images.u_image = await emptyImage;
  } else if (spec.textures.u_image === 'source') images.u_image = await sourceTexture(config);
  return images;
}