import type { DesignDocument, DesignNode, NodeType, ShaderConfig } from '../types';

export type McpLayout = {
  direction: 'row' | 'column';
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  align: 'start' | 'center' | 'end' | 'stretch';
  justify: 'start' | 'center' | 'end' | 'space-between';
};
export type CssStyles = Record<string, string | number>;
export type Styles = { layout?: McpLayout } & Partial<
  Pick<
    DesignNode,
    | 'x'
    | 'y'
    | 'width'
    | 'height'
    | 'rotation'
    | 'fill'
    | 'stroke'
    | 'strokeWidth'
    | 'radius'
    | 'opacity'
    | 'visible'
    | 'locked'
    | 'fontSize'
    | 'fontFamily'
    | 'fontWeight'
    | 'textAlign'
  >
>;
type ScopeArguments = { documentId?: string; fileId?: string; pageId?: string };
type Pagination = { offset: number; limit: number };
export type ToolArguments = {
  get_basic_info: Record<string, never>;
  get_selection: Record<string, never>;
  get_node_info: { nodeId: string };
  get_children: { parentId?: string | null; nodeId?: string } & Pagination;
  get_tree_summary: { nodeId?: string; depth?: number } & Pagination;
  find_nodes: {
    query: string;
    type?: NodeType;
    nodeId?: string;
    textValue?: string;
    filters?: { styleName?: string; styleValue?: string }[];
  } & Pagination;
  get_computed_styles: { nodeIds: string[] };
  list_shader_presets: { catalog: 'featured' | 'all' };
  apply_shader: { nodeIds: string[]; config: ShaderConfig | null };
  create_artboard: {
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    styles?: CssStyles;
  };
  create_nodes: {
    nodes: (Styles &
      Partial<Pick<DesignNode, 'id' | 'name' | 'parentId' | 'text' | 'src'>> & {
        type: NodeType;
      })[];
  };
  update_styles: { updates: { nodeIds: string[]; styles: Styles | CssStyles }[] };
  set_text_content: {
    updates: ({ nodeId: string; text: string } | { nodeId: string; textContent: string })[];
  };
  rename_nodes: { updates: { nodeId: string; name: string }[] };
  duplicate_nodes: { nodeIds?: string[]; nodes?: { id: string; parentId?: string }[] };
  delete_nodes: { nodeIds: string[] };
  move_nodes: {
    moves: (
      | { nodeId: string; parentId: string | null; x?: number; y?: number; index?: number }
      | { nodeId: string; before: string }
      | { nodeId: string; after: string }
    )[];
  };
  create_page: { name?: string };
  rename_pages: { updates: { pageId: string; name: string }[] };
  get_jsx: { nodeId?: string; format?: 'inline-styles' | 'tailwind' };
  export: {
    format?: 'svg' | 'html' | 'animated-html' | 'png' | 'jpg' | 'webp';
    nodeId?: string;
    type?: 'image';
    nodes?: Record<string, { format: 'svg' | 'png' | 'jpg' | 'webp'; scale: string }[]>;
  };
  get_screenshot: { nodeId?: string; scale: number };
  write_html: {
    html: string;
    parentId: string | null;
    x: number;
    y: number;
    width: number;
    name: string;
    targetNodeId?: string;
    mode?: 'insert-children' | 'replace';
  };
  get_capabilities: Record<string, never>;
  get_fill_image: { nodeId: string };
  get_font_family_info: { familyNames: string[] };
  get_guide: {
    topic: 'paper-mcp-instructions' | 'mobile-status-bar' | 'figma-import' | 'image-generation';
  };
};
export type McpCommand = {
  [K in keyof ToolArguments]: { name: K; args: ToolArguments[K] & ScopeArguments };
}[keyof ToolArguments];
export type McpContext = { documentId: string; pageId: string; epoch: string };
export type McpRequest = {
  id: string;
  name: string;
  args: unknown;
  context: McpContext;
  deadline: number;
};
export type McpErrorCode =
  | 'STALE_DOCUMENT'
  | 'NOT_READY'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_HTML'
  | 'LIMIT_EXCEEDED'
  | 'CANCELLED'
  | 'CAPTURE_FAILED'
  | 'UNSUPPORTED_OPERATION'
  | 'INTERNAL';
export type McpResult = {
  data: Record<string, unknown>;
  image?: { data: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
  text?: string;
};
export type McpReply = { id: string } & (
  { ok: true; result: McpResult } | { ok: false; code: McpErrorCode }
);
export type McpStatus = {
  enabled: boolean;
  endpoint: string | null;
  port: number | null;
  rendererReady: boolean;
  stdio?: { command: string; args: string[] };
};
export interface FolioMcpBridge {
  status(): Promise<McpStatus>;
  enable(options?: { port?: number }): Promise<McpStatus>;
  disable(): Promise<McpStatus>;
  setContext(context: McpContext | null): Promise<void>;
  reply(reply: McpReply): Promise<void>;
  onCommand(callback: (request: McpRequest) => void): () => void;
  onCancel(callback: (id: string) => void): () => void;
}
export type McpEditorAdapter = {
  design: DesignDocument | undefined;
  selected: string[];
  commit: (update: DesignDocument | ((current: DesignDocument) => DesignDocument)) => void;
  save: () => Promise<void>;
  setSelected: (ids: string[]) => void;
  animatedHtml?: (page: import('../types').DesignPage) => Promise<string>;
};
declare global {
  interface Window {
    folioMcp?: FolioMcpBridge;
  }
}
