import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from './storage';
import { createWelcomeDocument } from './sample';
import { validateDocument } from './model';
import type { DesignDocument } from './types';

type History = {
  document: DesignDocument;
  past: DesignDocument[];
  future: DesignDocument[];
};

export function useEditor() {
  const [history, setHistory] = useState<History | null>(null);
  const [status, setStatus] = useState('Opening local files…');
  const [error, setError] = useState('');
  const historyRef = useRef(history);
  historyRef.current = history;
  const pending = useRef(Promise.resolve());
  const lastSaved = useRef<DesignDocument | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const summaries = await storage.listDocuments();
      const document = summaries.length
        ? await storage.loadDocument(summaries[0].id)
        : createWelcomeDocument();
      if (mounted) {
        if (summaries.length) lastSaved.current = document;
        setHistory({ document, past: [], future: [] });
      }
    })().catch((cause: Error) => {
      if (mounted) setError(cause.message);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const save = useCallback(async () => {
    const document = historyRef.current?.document;
    if (!document || lastSaved.current === document) return;
    const version = ++revision.current;
    setStatus('Saving…');
    const task = pending.current.catch(() => {}).then(() => storage.saveDocument(document));
    pending.current = task;
    try {
      await task;
      lastSaved.current = document;
      if (version === revision.current && historyRef.current?.document === document)
        setStatus('Saved on this device');
    } catch (cause) {
      setStatus('Not saved');
      setError((cause as Error).message);
      throw cause;
    }
  }, []);

  useEffect(() => {
    if (!history) return;
    if (lastSaved.current === history.document) {
      setStatus('Saved on this device');
      return;
    }
    setStatus('Unsaved changes');
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [history?.document, save]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (historyRef.current && historyRef.current.document !== lastSaved.current) {
        event.preventDefault();
        event.returnValue = '';
        void save().catch(() => {});
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [save]);

  const commit = useCallback(
    (update: DesignDocument | ((document: DesignDocument) => DesignDocument)) => {
      setHistory((current) => {
        if (!current) return current;
        try {
          const next = typeof update === 'function' ? update(current.document) : update;
          if (next === current.document) return current;
          return {
            document: { ...validateDocument(next), updatedAt: new Date().toISOString() },
            past: [...current.past.slice(-99), current.document],
            future: [],
          };
        } catch (cause) {
          queueMicrotask(() =>
            setError(cause instanceof Error ? cause.message : 'The edit could not be applied.'),
          );
          return current;
        }
      });
    },
    [],
  );

  const undo = useCallback(
    () =>
      setHistory((current) => {
        if (!current?.past.length) return current;
        return {
          document: {
            ...current.past.at(-1)!,
            updatedAt: new Date().toISOString(),
          },
          past: current.past.slice(0, -1),
          future: [current.document, ...current.future],
        };
      }),
    [],
  );

  const redo = useCallback(
    () =>
      setHistory((current) => {
        if (!current?.future.length) return current;
        return {
          document: {
            ...current.future[0],
            updatedAt: new Date().toISOString(),
          },
          past: [...current.past, current.document],
          future: current.future.slice(1),
        };
      }),
    [],
  );

  const open = useCallback(
    async (document: DesignDocument) => {
      await save();
      const next = validateDocument(document);
      setHistory({ document: next, past: [], future: [] });
    },
    [save],
  );

  return {
    document: history?.document,
    commit,
    undo,
    redo,
    canUndo: Boolean(history?.past.length),
    canRedo: Boolean(history?.future.length),
    save,
    open,
    status:
      history && lastSaved.current !== history.document && status === 'Saved on this device'
        ? 'Unsaved changes'
        : status,
    error,
    setError,
  };
}
