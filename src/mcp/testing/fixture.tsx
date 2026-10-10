import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useState } from 'react';
import { useEditor } from '../../useEditor';
import { useMcp } from '../useMcp';
import type { DesignDocument } from '../../types';

export type TestControl = {
  document?: DesignDocument;
  selected: string[];
  commits: number;
  undo: () => void;
  switchPage: () => void;
  prepareSwitch: () => void;
  releaseSwitch: () => void;
};
declare global {
  interface Window {
    mcpTest?: TestControl;
  }
}

let commits = 0;
let switchDuringCommit = false;
function Fixture() {
  const editor = useEditor();
  const [selected, setSelected] = useState<string[]>([]);
  useMcp({
    design: editor.document,
    selected,
    commit(update) {
      if (switchDuringCommit) {
        switchDuringCommit = false;
        editor.commit((document) => ({
          ...document,
          activePageId:
            document.pages.find((page) => page.id !== document.activePageId)?.id ??
            document.activePageId,
        }));
      }
      commits += 1;
      editor.commit(update);
    },
    save: editor.save,
    setSelected,
  });
  useLayoutEffect(() => {
    window.mcpTest = {
      document: editor.document,
      selected,
      commits,
      undo: editor.undo,
      switchPage: () =>
        editor.commit((document) => ({
          ...document,
          activePageId:
            document.pages.find((page) => page.id !== document.activePageId)?.id ??
            document.activePageId,
        })),
      prepareSwitch: () => {
        switchDuringCommit = true;
      },
      releaseSwitch: () => {
        switchDuringCommit = false;
      },
    };
  });
  return (
    <main>
      <h1>MCP isolated transaction fixture</h1>
      <div role="dialog">
        <input
          aria-label="Unrelated provider credential"
          value="PRIVATE_PROVIDER_KEY_MUST_NOT_BE_CAPTURED"
          readOnly
        />
      </div>
      <p>{editor.status}</p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
