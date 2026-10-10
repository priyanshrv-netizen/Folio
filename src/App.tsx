import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CloudUpload,
  Code2,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Frame,
  Grid2X2,
  Hand,
  ImagePlus,
  Layers,
  Lock,
  Maximize,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  Settings2,
  Sparkles,
  Square,
  Type,
  Undo2,
  Waves,
  X,
  Moon,
  Sun,
  Menu,
  File,
  Palette,
} from 'lucide-react';
import { Canvas, type Tool, type View } from './Canvas';
import { Inspector } from './Inspector';
import { ExportDialog, FilesDialog, GenerateDialog, SettingsDialog } from './Dialogs';
import {
  createDocument,
  createNode,
  duplicateNodes,
  removeNodes,
  updateNodes,
  validateDocument,
} from './model';
import { isDesktop, storage } from './storage';
import { useEditor } from './useEditor';
import { ShaderLibrary } from './ShaderLibrary';
import { createShaderConfig } from './shaders';
import { createShaderPlayground } from './shaderPlayground';
import { useMcp } from './mcp/useMcp';
import { ConnectDialog } from './ConnectDialog';
import { ThemePanel } from './ThemePanel';
import { PagesPanel } from './PagesPanel';
import type { DesignDocument, DesignNode, DesignPage, ShaderKind } from './types';

async function animatedHtml(page: DesignPage) {
  return (await import('./exports')).exportAnimatedHtml(page);
}

const nodeIcons = {
  frame: Frame,
  rectangle: Square,
  ellipse: Circle,
  text: Type,
  image: ImagePlus,
};
const tools = [
  { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
  { id: 'hand', label: 'Hand', key: 'H', Icon: Hand },
  { id: 'frame', label: 'Artboard', key: 'F', Icon: Frame },
  { id: 'rectangle', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
] as const;

export function App() {
  const editor = useEditor();
  const { document: design, commit } = editor;
  const [selected, setSelected] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState<View>({ x: 60, y: 70, zoom: 1 });
  const [fitRequest, setFitRequest] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [dialog, setDialog] = useState<
    'files' | 'settings' | 'export' | 'generate' | 'connect' | null
  >(null);
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pagesOpen, setPagesOpen] = useState(true);
  const [notice, setNotice] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [leftTab, setLeftTab] = useState<'layers' | 'theme' | 'shaders'>('layers');
  const [layerSearch, setLayerSearch] = useState('');
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [appearance, setAppearance] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('folio.appearance');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    try {
      localStorage.setItem('folio.appearance', appearance);
    } catch {}
  }, [appearance]);
  const importInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const zoomMenu = useRef<HTMLDetailsElement>(null);
  const page = design?.pages.find((page) => page.id === design.activePageId);
  const canvasColor = page?.canvasColor ?? (appearance === 'dark' ? '#262626' : '#eeeeee');
  const selectedNodes = page?.nodes.filter((node) => selected.includes(node.id)) ?? [];
  const first = selectedNodes[0];
  const mcp = useMcp({ design, selected, commit, save: editor.save, setSelected, animatedHtml });
  const shaderSelection =
    selectedNodes.length > 0 &&
    selectedNodes.every(
      (node) => ['frame', 'rectangle', 'ellipse'].includes(node.type) && !node.locked,
    );

  const closeDialog = useCallback(() => setDialog(null), []);

  function changeZoom(zoom: number) {
    const viewport = window.document.querySelector('.canvas-viewport');
    const x = (viewport?.clientWidth ?? 0) / 2;
    const y = (viewport?.clientHeight ?? 0) / 2;
    const bounded = Math.max(0.1, Math.min(4, zoom));
    setView((previous) => ({
      zoom: bounded,
      x: x - ((x - previous.x) * bounded) / previous.zoom,
      y: y - ((y - previous.y) * bounded) / previous.zoom,
    }));
    if (zoomMenu.current) zoomMenu.current.open = false;
  }

  useEffect(() => {
    const closeZoom = (event: PointerEvent) => {
      if (zoomMenu.current && !zoomMenu.current.contains(event.target as Node))
        zoomMenu.current.open = false;
    };
    window.addEventListener('pointerdown', closeZoom);
    return () => window.removeEventListener('pointerdown', closeZoom);
  }, []);

  useEffect(() => setTitle(design?.name ?? ''), [design?.name, design?.id]);

  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    setSelected([]);
    setHovered(null);
    setMenu(false);
  }, [design?.id, page?.id]);
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => page?.nodes.some((node) => node.id === id)));
  }, [page?.nodes]);

  const patch = (patch: Partial<DesignNode>) => {
    if (!design || !page || !selected.length) return;
    try {
      commit(updateNodes(design, page.id, selected, patch));
    } catch (cause) {
      editor.setError((cause as Error).message);
    }
  };

  function insertShader(kind: ShaderKind) {
    if (!design || !page) return;
    const viewport = window.document.querySelector('.canvas-viewport');
    const width = 480;
    const height = 360;
    const node = createNode('rectangle', {
      name: `${kind
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(' ')} shader`,
      x: Math.round(((viewport?.clientWidth ?? 800) / 2 - view.x) / view.zoom - width / 2),
      y: Math.round(((viewport?.clientHeight ?? 600) / 2 - view.y) / view.zoom - height / 2),
      width,
      height,
      radius: 12,
      fill: '#161616',
      shader: createShaderConfig(kind),
    });
    commit(
      validateDocument({
        ...design,
        pages: design.pages.map((item) =>
          item.id === page.id ? { ...item, nodes: [...item.nodes, node] } : item,
        ),
      }),
    );
    setSelected([node.id]);
    setTool('select');
  }

  async function playground() {
    try {
      await open(createShaderPlayground());
      setLeftTab('shaders');
      setPanelsVisible(true);
    } catch (cause) {
      editor.setError((cause as Error).message);
    }
  }
  const remove = () => {
    if (design && page) {
      commit(removeNodes(design, page.id, selected));
      setSelected([]);
    }
  };
  const duplicate = () => {
    if (!design || !page) return;
    const result = duplicateNodes(design, page.id, selected);
    commit(result.document);
    setSelected(result.ids);
  };

  async function open(document: DesignDocument) {
    await editor.open(document);
    setSelected([]);
    setTool('select');
    setDialog(null);
    setMenu(false);
  }

  async function create() {
    try {
      await open(createDocument('Untitled'));
    } catch (cause) {
      editor.setError((cause as Error).message);
    }
  }

  async function insertImage(src: string) {
    const image = new Image();
    image.src = src;
    await image.decode();
    if (!design || !page) return;
    const width = Math.min(640, image.naturalWidth);
    const node = createNode('image', {
      name: 'Image',
      src,
      x: Math.round((180 - view.x) / view.zoom),
      y: Math.round((150 - view.y) / view.zoom),
      width,
      height: Math.max(1, Math.round((width * image.naturalHeight) / image.naturalWidth)),
    });
    commit({
      ...design,
      pages: design.pages.map((item) =>
        item.id === page.id ? { ...item, nodes: [...item.nodes, node] } : item,
      ),
    });
    setSelected([node.id]);
    setTool('select');
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const typing = (event.target as HTMLElement).closest(
        'input, textarea, select, [contenteditable="true"]',
      );
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (typing) (event.target as HTMLElement).blur();
        setTimeout(() => {
          void editor.save().catch(() => {});
        }, 0);
        return;
      }
      if (
        typing ||
        dialog ||
        !design ||
        !page ||
        (event.target as HTMLElement).closest('[role="menu"], [role="dialog"]')
      )
        return;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? editor.redo() : editor.undo();
        return;
      }
      if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (command && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicate();
        return;
      }
      if (command && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelected(
          page.nodes
            .filter((node) => !node.parentId && node.visible && !node.locked)
            .map((node) => node.id),
        );
        return;
      }
      if (command) return;
      if (event.key === 'Escape') {
        setSelected([]);
        setTool('select');
        setMenu(false);
        if (zoomMenu.current) zoomMenu.current.open = false;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove();
      }
      if (event.key === '1') setFitRequest((value) => value + 1);
      if (event.key === '0') changeZoom(1);
      const found = tools.find((tool) => tool.key.toLowerCase() === event.key.toLowerCase());
      if (found) setTool(found.id);
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
        selected.length
      ) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        const movable = selectedNodes.filter(
          (node) => !node.locked && !selected.includes(node.parentId ?? ''),
        );
        commit({
          ...design,
          pages: design.pages.map((item) =>
            item.id === page.id
              ? {
                  ...item,
                  nodes: item.nodes.map((node) =>
                    movable.some((item) => item.id === node.id)
                      ? {
                          ...node,
                          x:
                            node.x +
                            (event.key === 'ArrowLeft'
                              ? -distance
                              : event.key === 'ArrowRight'
                                ? distance
                                : 0),
                          y:
                            node.y +
                            (event.key === 'ArrowUp'
                              ? -distance
                              : event.key === 'ArrowDown'
                                ? distance
                                : 0),
                        }
                      : node,
                  ),
                }
              : item,
          ),
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (!design || !page)
    return (
      <main className="loading-screen">
        <div className="folio-mark">f</div>
        <h2>{editor.error ? 'Your files need a moment.' : 'Opening your canvas…'}</h2>
        <p>{editor.error || 'A space to make something yours.'}</p>
        {editor.error && (
          <button className="primary-button" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
      </main>
    );

  function layer(node: DesignNode, depth = 0) {
    const Icon = nodeIcons[node.type];
    const children = layerSearch ? [] : page!.nodes.filter((item) => item.parentId === node.id);
    return (
      <div key={node.id}>
        <div
          className={`layer-row ${selected.includes(node.id) ? 'active' : ''} ${hovered === node.id ? 'hovered' : ''} ${!node.visible ? 'hidden-layer' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          onPointerEnter={() => setHovered(node.id)}
          onPointerLeave={() => setHovered(null)}
        >
          <button
            className="layer-toggle"
            aria-label={`${collapsed.has(node.id) ? 'Expand' : 'Collapse'} ${node.name}`}
            style={{ visibility: children.length ? 'visible' : 'hidden' }}
            onClick={() =>
              setCollapsed((set) => {
                const next = new Set(set);
                next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                return next;
              })
            }
          >
            {collapsed.has(node.id) ? <ChevronRight /> : <ChevronDown />}
          </button>
          <button
            className="layer-select"
            aria-label={`Select layer ${node.name}`}
            onClick={(event) =>
              setSelected((ids) =>
                event.shiftKey
                  ? ids.includes(node.id)
                    ? ids.filter((id) => id !== node.id)
                    : [...ids, node.id]
                  : [node.id],
              )
            }
          >
            <Icon />
            <span>{node.name}</span>
          </button>
          {node.locked && <Lock className="layer-state" />}
          {!node.visible && <EyeOff className="layer-state" />}
        </div>
        {!collapsed.has(node.id) && [...children].reverse().map((child) => layer(child, depth + 1))}
      </div>
    );
  }

  return (
    <div
      className={`app-shell ${isDesktop ? 'desktop-shell' : ''} ${panelsVisible ? '' : 'panels-hidden'}`}
    >
      <header className="topbar">
        <div className="topbar-left">
          <button className="brand-button" aria-label="File menu" onClick={() => setMenu(!menu)}>
            <Menu size={14} />
          </button>
          <button
            className="dashboard-tab"
            title="Your files"
            aria-label="Your files"
            onClick={async () => {
              try {
                await editor.save();
                setDialog('files');
              } catch {}
            }}
          >
            <Grid2X2 />
            Dashboard
          </button>
          <div className="topbar-divider" />
          <div className="document-tab">
            <File size={16} />
            <input
              aria-label="Document name"
              className="document-title"
              maxLength={256}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                const name = title.trim() || 'Untitled';
                setTitle(name);
                if (name !== design.name) commit({ ...design, name });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <button
              className="tab-close"
              aria-label="Close document tab"
              title="Close document tab"
              onClick={async () => {
                try {
                  await editor.save();
                  setDialog('files');
                } catch {}
              }}
            >
              <X size={13} />
            </button>
          </div>
          <button
            className="icon-button new-document"
            aria-label="New document tab"
            title="New file"
            onClick={() => void create()}
          >
            <Plus />
          </button>
        </div>
        <div className="topbar-right">
          <span
            className={`save-status ${editor.status === 'Not saved' ? 'failed' : ''}`}
            role="status"
          >
            {editor.status === 'Saved on this device' && <Check size={13} />}
            {editor.status}
          </span>
        </div>
      </header>
      {menu && (
        <>
          <div className="menu-dismiss" onClick={() => setMenu(false)} />
          <div className="file-menu">
            <div className="menu-label">
              FOLIO <span>LOCAL STUDIO</span>
            </div>
            <button onClick={() => void create()}>
              <FilePlus2 />
              New file<span>Blank canvas</span>
            </button>
            <button onClick={() => void playground()}>
              <Palette />
              Shader playground
            </button>
            <button
              onClick={async () => {
                try {
                  await editor.save();
                  setDialog('files');
                  setMenu(false);
                } catch {}
              }}
            >
              <FolderOpen />
              Open local file
            </button>
            <button
              onClick={() => {
                importInput.current?.click();
                setMenu(false);
              }}
            >
              <ArrowDownToLine />
              Import .folio.json
            </button>
            <hr />
            <button
              aria-pressed={appearance === 'dark'}
              onClick={() => {
                setAppearance('dark');
                setMenu(false);
              }}
            >
              <Moon />
              Dark appearance
              {appearance === 'dark' && <Check size={12} />}
            </button>
            <button
              aria-pressed={appearance === 'light'}
              onClick={() => {
                setAppearance('light');
                setMenu(false);
              }}
            >
              <Sun />
              Light appearance
              {appearance === 'light' && <Check size={12} />}
            </button>
            <button
              aria-pressed={showGrid}
              onClick={() => {
                setShowGrid(!showGrid);
                setMenu(false);
              }}
            >
              <Grid2X2 />
              {showGrid ? 'Hide dot grid' : 'Show dot grid'}
            </button>
            <button
              disabled={cloudBusy}
              onClick={async () => {
                setMenu(false);
                setCloudBusy(true);
                try {
                  await editor.save();
                  await storage.syncDocument(design);
                  setNotice('Snapshot uploaded to your bucket.');
                } catch (cause) {
                  editor.setError((cause as Error).message);
                } finally {
                  setCloudBusy(false);
                }
              }}
            >
              <CloudUpload />
              {cloudBusy ? 'Uploading…' : 'Back up to cloud'}
            </button>
            <button
              onClick={() => {
                setDialog('settings');
                setMenu(false);
              }}
            >
              <Settings2 />
              Settings
            </button>
          </div>
        </>
      )}
      <main className="workspace">
        <aside className="left-panel">
          <div className="left-panel-heading">
            <span className="file-symbol">
              <Layers size={14} />
            </span>
            <strong>{design.name}</strong>
            <button
              className="icon-button"
              aria-label="Hide panels"
              title="Hide panels"
              onClick={() => setPanelsVisible(false)}
            >
              <PanelLeftClose />
            </button>
          </div>
          <div
            className="design-theme-tabs"
            role="tablist"
            aria-label="Editor panels"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const theme = event.key === 'End' || (event.key !== 'Home' && leftTab !== 'theme');
              setLeftTab(theme ? 'theme' : 'layers');
              event.currentTarget
                .querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [theme ? 1 : 0].focus();
            }}
          >
            <button
              role="tab"
              aria-label="Design / Layers"
              aria-selected={leftTab !== 'theme'}
              tabIndex={leftTab !== 'theme' ? 0 : -1}
              onClick={() => setLeftTab('layers')}
            >
              Design
            </button>
            <button
              role="tab"
              aria-selected={leftTab === 'theme'}
              tabIndex={leftTab === 'theme' ? 0 : -1}
              onClick={() => setLeftTab('theme')}
            >
              Theme
            </button>
          </div>
          {leftTab === 'layers' && (
            <>
              <PagesPanel
                key={design.id}
                document={design}
                commit={commit}
                expanded={pagesOpen}
                setExpanded={setPagesOpen}
                search={layerSearch}
                setSearch={setLayerSearch}
              />
              <div className="layer-list" role="tabpanel" aria-label="Layers">
                {page.nodes.length ? (
                  [...page.nodes]
                    .filter((node) =>
                      layerSearch
                        ? node.name.toLowerCase().includes(layerSearch.toLowerCase())
                        : !node.parentId,
                    )
                    .reverse()
                    .map((node) => layer(node))
                ) : (
                  <div className="empty-layers">
                    Your layers will appear here.
                    <br />
                    Start with a shape or artboard.
                  </div>
                )}
              </div>
            </>
          )}
          {leftTab === 'theme' && (
            <ThemePanel document={design} commit={commit} selected={selected} />
          )}
          {leftTab === 'shaders' && (
            <ShaderLibrary
              apply={(kind) => shaderSelection && patch({ shader: createShaderConfig(kind) })}
              insert={insertShader}
              playground={() => void playground()}
              canApply={shaderSelection}
              selectedKind={first?.shader?.kind}
            />
          )}
          <button className="local-footer" onClick={() => setDialog('settings')}>
            <span className="device-dot" />
            <span>{isDesktop ? 'Local files' : 'Browser files'} · Settings</span>
            <Settings2 size={14} />
          </button>
        </aside>
        <nav className="tool-rail" aria-label="Drawing tools">
          {!panelsVisible && (
            <button
              className="tool-button"
              aria-label="Show panels"
              title="Show panels"
              onClick={() => setPanelsVisible(true)}
            >
              <PanelLeftOpen />
            </button>
          )}
          {tools.map(({ id, label, key, Icon }, index) => (
            <div className={`tool-slot ${index === 2 ? 'separator' : ''}`} key={id}>
              <button
                className={`tool-button ${tool === id ? 'active' : ''}`}
                aria-label={`${label} tool`}
                aria-pressed={tool === id}
                title={`${label} (${key})`}
                onClick={() => setTool(id)}
              >
                <Icon />
              </button>
            </div>
          ))}
          <div className="rail-divider" />
          <button
            className="tool-button"
            aria-label="Import image"
            title="Import image"
            onClick={() => imageInput.current?.click()}
          >
            <ImagePlus />
          </button>
          <button
            className={`tool-button shader-tool ${leftTab === 'shaders' ? 'active' : ''}`}
            aria-label="Shader library"
            title="Paper shaders"
            onClick={() => {
              setPanelsVisible(true);
              setLeftTab('shaders');
            }}
          >
            <Waves />
          </button>
          <button
            className="tool-button"
            aria-label="Open shader playground"
            title="Open shader playground"
            onClick={() => void playground()}
          >
            <Palette />
          </button>
          <button
            className="tool-button"
            aria-label="Generate image"
            title="Generate with your own API"
            onClick={() => setDialog('generate')}
          >
            <Sparkles />
          </button>
          <div className="rail-spacer" />
          <button
            className={`tool-button ${mcp.status.enabled ? 'active' : ''}`}
            aria-label="Connect agents"
            title="Connect agents"
            onClick={() => setDialog('connect')}
          >
            <Code2 />
          </button>
          <button
            className="tool-button"
            aria-label="Export"
            title="Export"
            onClick={() => setDialog('export')}
          >
            <ArrowDownToLine />
          </button>
          <button
            className="tool-button"
            aria-label="Undo"
            title="Undo (Ctrl Z)"
            disabled={!editor.canUndo}
            onClick={editor.undo}
          >
            <Undo2 />
          </button>
          <button
            className="tool-button"
            aria-label="Redo"
            title="Redo (Ctrl Shift Z)"
            disabled={!editor.canRedo}
            onClick={editor.redo}
          >
            <Redo2 />
          </button>
          <button
            className="tool-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setDialog('settings')}
          >
            <Settings2 />
          </button>
        </nav>
        <section className="canvas-area">
          <Canvas
            document={design}
            page={page}
            selected={selected}
            setSelected={setSelected}
            hovered={hovered}
            setHovered={setHovered}
            commit={commit}
            tool={tool}
            setTool={setTool}
            view={view}
            setView={setView}
            fitRequest={fitRequest}
            showGrid={showGrid}
            canvasColor={canvasColor}
          />
          <div className="canvas-topline">
            <span>{page.name}</span>
            <span>
              {selectedNodes.length
                ? `${selectedNodes.length} selected`
                : `${page.nodes.filter((node) => node.type === 'frame' && !node.parentId).length} artboards`}
            </span>
          </div>

          <div className="zoom-controls">
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => changeZoom(view.zoom / 1.25)}
            >
              <Minus />
            </button>
            <button className="zoom-value" title="Reset to 100%" onClick={() => changeZoom(1)}>
              {Math.round(view.zoom * 100)}%
            </button>
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => changeZoom(view.zoom * 1.25)}
            >
              <Plus />
            </button>
            <div className="zoom-divider" />
            <button
              className="icon-button"
              aria-label="Fit to canvas"
              title="Fit to canvas (1)"
              onClick={() => setFitRequest((value) => value + 1)}
            >
              <Maximize />
            </button>
          </div>
          <div className="canvas-help">
            {tool === 'select'
              ? 'Space to pan · Ctrl + scroll to zoom'
              : tool === 'hand'
                ? 'Drag to explore your canvas'
                : `Click or drag to draw ${tool === 'frame' ? 'an artboard' : `a ${tool}`} · Shift for equal sides`}
          </div>
        </section>
        <Inspector
          header={
            <div className="inspector-toolbar">
              <span className="local-avatar" title="Local workspace — no cloud collaboration">
                F
              </span>
              <details className="zoom-menu" ref={zoomMenu}>
                <summary aria-label="Canvas zoom">
                  {Math.round(view.zoom * 100)}% <ChevronDown size={12} />
                </summary>
                <div className="zoom-menu-content">
                  <button onClick={() => changeZoom(view.zoom * 1.25)}>
                    Zoom in <span>+</span>
                  </button>
                  <button onClick={() => changeZoom(view.zoom / 1.25)}>
                    Zoom out <span>−</span>
                  </button>
                  {[50, 100, 200].map((value) => (
                    <button key={value} onClick={() => changeZoom(value / 100)}>
                      {value}%
                    </button>
                  ))}
                  <hr />
                  <button
                    onClick={() => {
                      setFitRequest((value) => value + 1);
                      if (zoomMenu.current) zoomMenu.current.open = false;
                    }}
                  >
                    Fit to canvas <span>1</span>
                  </button>
                </div>
              </details>
              <button
                className="share-button"
                title="Share by exporting a local file"
                onClick={() => setDialog('export')}
              >
                Share
              </button>
            </div>
          }
          zoom={view.zoom}
          canvasColor={canvasColor}
          onCanvasColorChange={(canvasColor) =>
            commit({
              ...design,
              pages: design.pages.map((item) =>
                item.id === page.id ? { ...item, canvasColor } : item,
              ),
            })
          }
          node={first}
          count={selectedNodes.length}
          patch={patch}
          duplicate={duplicate}
          remove={remove}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          onShaders={() => {
            setPanelsVisible(true);
            setLeftTab('shaders');
          }}
          onPlayground={() => void playground()}
          onConnect={() => setDialog('connect')}
          canShadeSelection={shaderSelection}
          onExport={() => setDialog('export')}
          reorder={(direction) => {
            const selectedSet = new Set(selected);
            const moving = page.nodes.filter((node) => selectedSet.has(node.id));
            const other = page.nodes.filter((node) => !selectedSet.has(node.id));
            commit({
              ...design,
              pages: design.pages.map((item) =>
                item.id === page.id
                  ? {
                      ...item,
                      nodes: direction === 'front' ? [...other, ...moving] : [...moving, ...other],
                    }
                  : item,
              ),
            });
          }}
        />
      </main>
      <input
        ref={importInput}
        type="file"
        accept=".json,.folio"
        hidden
        aria-label="Import document file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            if (file.size > 32 * 1024 * 1024)
              throw new Error('Document exceeds the 32 MB import limit.');
            const document = validateDocument(JSON.parse(await file.text()));
            await open({ ...document, id: crypto.randomUUID() });
            setNotice('Document imported as a new local file.');
          } catch (cause) {
            editor.setError((cause as Error).message);
          }
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label="Import image file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            if (file.size > 10 * 1024 * 1024)
              throw new Error('Please choose an image smaller than 10 MB.');
            if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
              throw new Error('Choose a PNG, JPG, WebP, or GIF image.');
            const reader = new FileReader();
            const src = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error('Could not read image.'));
              reader.readAsDataURL(file);
            });
            await insertImage(src);
          } catch (cause) {
            editor.setError((cause as Error).message);
          }
        }}
      />
      {dialog === 'settings' && <SettingsDialog close={closeDialog} />}
      {dialog === 'connect' && <ConnectDialog close={closeDialog} mcp={mcp} />}
      {dialog === 'files' && (
        <FilesDialog close={closeDialog} open={open} create={() => void create()} />
      )}
      {dialog === 'export' && <ExportDialog document={design} page={page} close={closeDialog} />}
      {dialog === 'generate' && (
        <GenerateDialog
          close={closeDialog}
          insert={insertImage}
          settings={() => setDialog('settings')}
        />
      )}
      {(notice || editor.error) && (
        <div
          className={`toast ${editor.error ? 'error' : ''}`}
          role={editor.error ? 'alert' : 'status'}
        >
          <span>{editor.error || notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => {
              editor.setError('');
              setNotice('');
            }}
          >
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
