import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { prepareCommand } from './commands';
import { CommandError } from './errors';
import type { McpContext, McpEditorAdapter, McpRequest, McpStatus } from './types';

const initialStatus: McpStatus = {
  enabled: false,
  endpoint: null,
  port: null,
  rendererReady: false,
};

export function useMcp(adapter: McpEditorAdapter) {
  const current = useRef(adapter);
  const context = useRef<McpContext | null>(null);
  const active = useRef(new Map<string, AbortController>());
  const [status, setStatus] = useState<McpStatus>(initialStatus);
  useLayoutEffect(() => {
    current.current = adapter;
    const design = adapter.design;
    if (
      context.current?.documentId === design?.id &&
      context.current?.pageId === design?.activePageId
    )
      return;
    for (const controller of active.current.values()) controller.abort();
    context.current = design
      ? { documentId: design.id, pageId: design.activePageId, epoch: crypto.randomUUID() }
      : null;
    void window.folioMcp
      ?.setContext(context.current)
      .then(() => window.folioMcp?.status())
      .then((value) => {
        if (value) setStatus(value);
      })
      .catch(() => {});
  });

  useEffect(() => {
    const bridge = window.folioMcp;
    if (!bridge) return;
    let mounted = true;
    const run = async (request: McpRequest) => {
      const controller = new AbortController();
      active.current.set(request.id, controller);
      const alive = () => {
        if (!mounted || controller.signal.aborted || Date.now() >= request.deadline)
          throw new CommandError('CANCELLED');
        const scope = context.current;
        if (
          !scope ||
          scope.epoch !== request.context.epoch ||
          scope.documentId !== request.context.documentId ||
          scope.pageId !== request.context.pageId
        )
          throw new CommandError('STALE_DOCUMENT');
      };
      try {
        alive();
        const snapshot = current.current.design;
        if (!snapshot) throw new CommandError('NOT_READY');
        const prepared = await prepareCommand(request, snapshot, current.current.selected, {
          animatedHtml: current.current.animatedHtml,
        });
        alive();
        if (current.current.design !== snapshot) throw new CommandError('STALE_DOCUMENT');
        if (prepared.document) {
          const next = prepared.document;
          flushSync(() =>
            current.current.commit((document) =>
              document === snapshot && !controller.signal.aborted && Date.now() < request.deadline
                ? next
                : document,
            ),
          );
          const committed = current.current.design;
          if (
            !committed ||
            committed === snapshot ||
            committed.id !== next.id ||
            committed.activePageId !== next.activePageId ||
            committed.name !== next.name ||
            JSON.stringify(committed.pages) !== JSON.stringify(next.pages)
          )
            throw new CommandError('STALE_DOCUMENT');
          if (prepared.selected) flushSync(() => current.current.setSelected(prepared.selected!));
          try {
            await current.current.save();
            prepared.result.data.saved = true;
          } catch {
            prepared.result.data.saved = false;
            prepared.result.data.warning =
              'The edit is applied and undoable, but local saving failed. Check Folio before closing.';
          }
        }
        alive();
        await bridge.reply({ id: request.id, ok: true, result: prepared.result });
      } catch (error) {
        await bridge
          .reply({
            id: request.id,
            ok: false,
            code: error instanceof CommandError ? error.code : 'INTERNAL',
          })
          .catch(() => {});
      } finally {
        active.current.delete(request.id);
      }
    };
    const unsubscribe = bridge.onCommand((request) => {
      void run(request);
    });
    const cancel = bridge.onCancel((id) => active.current.get(id)?.abort());
    void bridge
      .setContext(context.current)
      .then(() => bridge.status())
      .then((value) => {
        if (mounted) setStatus(value);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      unsubscribe();
      cancel();
      for (const controller of active.current.values()) controller.abort();
      void bridge.setContext(null).catch(() => {});
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    const next = (await window.folioMcp?.status()) ?? initialStatus;
    setStatus(next);
    return next;
  }, []);
  const enable = useCallback(async (port?: number) => {
    if (!window.folioMcp) throw new Error('Local MCP is available only in the Folio desktop app.');
    const next = await window.folioMcp.enable(port === undefined ? {} : { port });
    setStatus(next);
    return next;
  }, []);
  const disable = useCallback(async () => {
    const next = (await window.folioMcp?.disable()) ?? initialStatus;
    setStatus(next);
    return next;
  }, []);
  return { status, enable, disable, refreshStatus };
}
