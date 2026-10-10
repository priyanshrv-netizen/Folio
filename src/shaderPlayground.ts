import { createDocument, createNode } from './model';
import { createShaderConfig } from './shaders';
import type { DesignNode } from './types';

export function createShaderPlayground() {
  const document = createDocument('Form & frequency');
  document.pages[0].name = 'Explorations';
  const hero = createNode('frame', {
    name: '01 / Chromatic studies',
    x: 0,
    y: 0,
    width: 800,
    height: 580,
    fill: '#101012',
    shader: {
      ...createShaderConfig('mesh-gradient'),
      colors: ['#172154', '#3144b0', '#fa613d', '#f2accc'],
      speed: 0.4,
    },
  });
  const metal = createNode('frame', {
    name: '02 / Liquid metal',
    x: 848,
    y: 0,
    width: 340,
    height: 360,
    fill: '#111111',
    shader: createShaderConfig('liquid-metal'),
  });
  const grain = createNode('frame', {
    name: '03 / Grain gradient',
    x: 848,
    y: 408,
    width: 340,
    height: 172,
    fill: '#111111',
    shader: createShaderConfig('grain-gradient'),
  });
  const text = (parentId: string, overrides: Partial<DesignNode>) =>
    createNode('text', { parentId, fill: '#ffffff', fontFamily: 'Inter', ...overrides });
  document.pages[0].nodes = [
    hero,
    text(hero.id, {
      name: 'Studio label',
      x: 42,
      y: 34,
      width: 360,
      height: 24,
      text: 'FOLIO     /     MATERIAL EXPLORATIONS',
      fontSize: 12,
      fontWeight: 500,
    }),
    text(hero.id, {
      name: 'Edition',
      x: 642,
      y: 34,
      width: 116,
      height: 24,
      text: 'STUDY 001',
      fontSize: 12,
      textAlign: 'right',
    }),
    text(hero.id, {
      name: 'Headline',
      x: 38,
      y: 174,
      width: 710,
      height: 230,
      text: 'Form &\nfrequency.',
      fontSize: 90,
      fontWeight: 500,
    }),
    createNode('rectangle', {
      parentId: hero.id,
      name: 'Hairline',
      x: 42,
      y: 459,
      width: 716,
      height: 1,
      fill: '#ffffff66',
    }),
    text(hero.id, {
      name: 'Caption',
      x: 42,
      y: 486,
      width: 570,
      height: 44,
      text: 'A living canvas. A different point of view.\nSelect an artboard. Make the material your own.',
      fontSize: 14,
    }),
    text(hero.id, {
      name: 'Arrow',
      x: 713,
      y: 477,
      width: 48,
      height: 48,
      text: '↗',
      fontSize: 40,
    }),
    metal,
    createNode('rectangle', {
      parentId: metal.id,
      name: 'Label backing',
      x: 16,
      y: 16,
      width: 106,
      height: 28,
      radius: 3,
      fill: '#ffffff',
    }),
    createNode('rectangle', {
      parentId: metal.id,
      name: 'Caption backing',
      x: 0,
      y: 266,
      width: 340,
      height: 94,
      fill: '#ffffff',
    }),
    text(metal.id, {
      name: 'Metal label',
      x: 24,
      y: 23,
      width: 92,
      height: 21,
      text: 'LIQUID / 02',
      fontSize: 11,
      fill: '#222222',
      fontWeight: 600,
    }),
    text(metal.id, {
      name: 'Metal title',
      x: 22,
      y: 287,
      width: 292,
      height: 52,
      text: 'Matter in motion.',
      fontSize: 28,
      fill: '#181818',
      fontWeight: 500,
    }),
    grain,
    text(grain.id, {
      name: 'Grain label',
      x: 22,
      y: 22,
      width: 280,
      height: 24,
      text: 'TEXTURE / 03',
      fontSize: 11,
    }),
    text(grain.id, {
      name: 'Grain title',
      x: 22,
      y: 109,
      width: 292,
      height: 40,
      text: 'A little friction.',
      fontSize: 26,
      fontWeight: 500,
    }),
  ];
  return document;
}
