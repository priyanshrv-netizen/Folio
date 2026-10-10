export type NodeType = 'frame' | 'rectangle' | 'ellipse' | 'text' | 'image';

export type ShaderKind =
  | 'mesh-gradient'
  | 'grain-gradient'
  | 'liquid-metal'
  | 'waves'
  | 'dot-orbit'
  | 'smoke'
  | 'static-mesh-gradient'
  | 'static-radial-gradient'
  | 'dithering'
  | 'dot-grid'
  | 'warp'
  | 'spiral'
  | 'swirl'
  | 'neuro-noise'
  | 'perlin-noise'
  | 'simplex-noise'
  | 'voronoi'
  | 'pulsing-border'
  | 'metaballs'
  | 'color-panels'
  | 'god-rays'
  | 'paper-texture'
  | 'fluted-glass'
  | 'water'
  | 'image-dithering'
  | 'halftone-dots'
  | 'halftone-cmyk'
  | 'lens-distortion'
  | 'heatmap'
  | 'gem-smoke'
  | 'smoke-ring';

export interface ShaderConfig {
  kind: ShaderKind;
  colors: string[];
  speed: number;
  scale: number;
  detail: number;
  paused: boolean;
  source?: string;
  parameters?: Record<string, number | boolean>;
}

export type ShaderSnapshots = Readonly<Record<string, string>>;

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'plus-lighter';

export interface NodeShadow {
  color: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
}

export interface NodeFilters {
  blur: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface ColorToken {
  id: string;
  name: string;
  value: string;
}

export interface FrameLayout {
  direction: 'row' | 'column';
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'space-between';
}

export interface DesignNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  widthMode?: 'fixed' | 'fit';
  heightMode?: 'fixed' | 'fit';
  clipContent?: boolean;
  blendMode?: BlendMode;
  shadow?: NodeShadow;
  innerShadow?: NodeShadow;
  filters?: NodeFilters;
  fillTokenId?: string;
  shader?: ShaderConfig;
  layout?: FrameLayout;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  textAlign?: 'left' | 'center' | 'right';
  src?: string;
}

export interface DesignPage {
  id: string;
  name: string;
  nodes: DesignNode[];
  canvasColor?: string;
}

export interface DesignDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  pages: DesignPage[];
  activePageId: string;
  createdAt: string;
  updatedAt: string;
  tokens?: ColorToken[];
}

export interface DocumentSummary {
  id: string;
  name: string;
  updatedAt: string;
  pageCount: number;
}

export interface AppSettings {
  storage: {
    provider: 'local' | 's3';
    endpoint: string;
    region: string;
    bucket: string;
    prefix: string;
    hasCredentials: boolean;
  };
  image: {
    endpoint: string;
    model: string;
    hasApiKey: boolean;
  };
}

export interface SettingsInput {
  storage: Omit<AppSettings['storage'], 'hasCredentials'> & {
    accessKeyId?: string;
    secretAccessKey?: string;
    clearCredentials?: boolean;
  };
  image: Omit<AppSettings['image'], 'hasApiKey'> & {
    apiKey?: string;
    clearApiKey?: boolean;
  };
}

export interface FolioBridge {
  listDocuments(): Promise<DocumentSummary[]>;
  loadDocument(id: string): Promise<DesignDocument>;
  saveDocument(document: DesignDocument): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: SettingsInput): Promise<AppSettings>;
  syncDocument(document: DesignDocument): Promise<{ key: string }>;
  listCloudDocuments(): Promise<DocumentSummary[]>;
  loadCloudDocument(id: string): Promise<DesignDocument>;
  generateImage(prompt: string): Promise<{ dataUrl: string }>;
}

declare global {
  interface Window {
    folio?: FolioBridge;
  }
}
