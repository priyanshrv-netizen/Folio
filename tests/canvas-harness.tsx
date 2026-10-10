import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, type Tool, type View } from '../src/Canvas';
import { createDocument } from '../src/model';
import type { DesignDocument } from '../src/types';
import '../src/styles.css';

interface Inputs {
  document: DesignDocument;
  selected: string[];
  hovered: string | null;
  tool: Tool;
  view: View;
  canvasColor?: string;
}

declare global {
  interface Window {
    canvasHarness: {
      read(): Inputs & { commits: number; selectionChanges: number };
      update(inputs: Partial<Inputs>): void;
    };
  }
}

function CanvasHarness() {
  const [document, setDocument] = useState(() => createDocument('Canvas fixture'));
  const [selected, setSelected] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [canvasColor, setCanvasColor] = useState<string>();
  const commits = useRef(0);
  const selectionChanges = useRef(0);
  const commit = useCallback((document: DesignDocument) => {
    commits.current++;
    setDocument(document);
  }, []);
  const select = useCallback((selected: SetStateAction<string[]>) => {
    selectionChanges.current++;
    setSelected(selected);
  }, []);

  useEffect(() => {
    window.canvasHarness = {
      read: () => ({
        document,
        selected,
        hovered,
        tool,
        view,
        canvasColor,
        commits: commits.current,
        selectionChanges: selectionChanges.current,
      }),
      update: (inputs) => {
        if (inputs.document) setDocument(inputs.document);
        if (inputs.selected) setSelected(inputs.selected);
        if (inputs.hovered !== undefined) setHovered(inputs.hovered);
        if (inputs.tool) setTool(inputs.tool);
        if (inputs.view) setView(inputs.view);
        if ('canvasColor' in inputs) setCanvasColor(inputs.canvasColor);
      },
    };
  }, [document, selected, hovered, tool, view, canvasColor]);

  return (
    <div style={{ position: 'absolute', inset: 32 }}>
      <Canvas
        document={document}
        page={document.pages.find((page) => page.id === document.activePageId)!}
        selected={selected}
        setSelected={select}
        hovered={hovered}
        setHovered={setHovered}
        commit={commit}
        tool={tool}
        setTool={setTool}
        view={view}
        setView={setView}
        fitRequest={0}
        showGrid={false}
        canvasColor={canvasColor}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<CanvasHarness />);
