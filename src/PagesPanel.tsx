import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  File,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Modal } from './Dialogs';
import { addPage, movePage, removePage, renamePage } from './model';
import type { DesignDocument, DesignPage } from './types';

export function PagesPanel({
  document: design,
  commit,
  expanded,
  setExpanded,
  search,
  setSearch,
}: {
  document: DesignDocument;
  commit: (update: DesignDocument | ((document: DesignDocument) => DesignDocument)) => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  search: string;
  setSearch: (search: string) => void;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [action, setAction] = useState<{ id: string; type: 'rename' | 'delete' } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const rows = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const menuPage = design.pages.find((page) => page.id === menu?.id);
  const actionPage = design.pages.find((page) => page.id === action?.id);
  const menuIndex = menuPage ? design.pages.indexOf(menuPage) : -1;
  const closeAction = useCallback(() => setAction(null), []);

  useEffect(() => {
    if (action?.type === 'rename') nameInput.current?.focus();
  }, [action]);

  useEffect(() => {
    setMenu(null);
    setAction(null);
    setDragging(null);
    setDropTarget(null);
  }, [design.activePageId]);

  useEffect(() => {
    if (!menu) return;
    menuElement.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !menuElement.current?.contains(event.target as Node) &&
        !menuTrigger.current?.contains(event.target as Node)
      )
        setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  function closeMenu() {
    setMenu(null);
    menuTrigger.current?.focus();
  }

  function beginAction(page: DesignPage, type: 'rename' | 'delete', trigger?: HTMLElement) {
    if (trigger) menuTrigger.current = trigger;
    closeMenu();
    setName(page.name);
    setError('');
    setAction({ id: page.id, type });
  }

  function showMenu(page: DesignPage, trigger: HTMLElement) {
    menuTrigger.current = trigger;
    const bounds = trigger.getBoundingClientRect();
    setMenu({
      id: page.id,
      x: Math.max(8, Math.min(bounds.right - 192, window.innerWidth - 200)),
      y: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 144)),
    });
  }

  function saveAction() {
    if (!action || !actionPage) return;
    try {
      const next =
        action.type === 'rename'
          ? renamePage(design, action.id, name)
          : removePage(design, action.id);
      commit(next);
      closeAction();
      if (action.type === 'delete')
        rows.current
          ?.querySelector<HTMLButtonElement>(`[data-page-id="${next.activePageId}"] .page-select`)
          ?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The page could not be updated.');
    }
  }

  return (
    <section
      className="pages-section"
      aria-label="Document pages"
      onKeyDown={(event) => {
        if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
      }}
    >
      <div className="section-heading">
        <button
          className="pages-disclosure"
          aria-label="Pages"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Pages
        </button>
        <label className="layer-search" title="Search layers">
          <Search />
          <input
            aria-label="Search layers"
            placeholder="Search layers…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="icon-button"
          aria-label="Add page"
          title={design.pages.length >= 100 ? 'A document can have up to 100 pages' : 'Add page'}
          disabled={design.pages.length >= 100}
          onClick={() => {
            commit(addPage);
            setExpanded(true);
          }}
        >
          <Plus />
        </button>
      </div>
      {expanded && (
        <div
          className="page-list"
          ref={rows}
          onScroll={() => setMenu(null)}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null);
          }}
        >
          {design.pages.map((page, index) => (
            <div
              key={page.id}
              data-page-id={page.id}
              className={`page-row ${page.id === design.activePageId ? 'active' : ''} ${dragging === page.id ? 'dragging' : ''}`}
              data-drop={
                dropTarget?.id === page.id ? (dropTarget.after ? 'after' : 'before') : undefined
              }
              onContextMenu={(event) => {
                event.preventDefault();
                showMenu(
                  page,
                  event.currentTarget.querySelector<HTMLButtonElement>('.page-actions')!,
                );
              }}
              onDragOver={(event) => {
                if (!dragging || dragging === page.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const bounds = event.currentTarget.getBoundingClientRect();
                setDropTarget({
                  id: page.id,
                  after: event.clientY > bounds.top + bounds.height / 2,
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && dropTarget?.id === page.id) {
                  const from = design.pages.findIndex((item) => item.id === dragging);
                  const to = index + (dropTarget.after ? 1 : 0) - (from < index ? 1 : 0);
                  if (from >= 0) commit((current) => movePage(current, dragging, to));
                }
                setDragging(null);
                setDropTarget(null);
              }}
            >
              <button
                className="page-select"
                title={page.name}
                aria-current={page.id === design.activePageId ? 'page' : undefined}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-folio-page', page.id);
                  event.dataTransfer.effectAllowed = 'move';
                  setDragging(page.id);
                  setMenu(null);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                onClick={() =>
                  commit((current) =>
                    current.activePageId === page.id
                      ? current
                      : { ...current, activePageId: page.id },
                  )
                }
                onDoubleClick={(event) => beginAction(page, 'rename', event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key === 'F2') {
                    event.preventDefault();
                    beginAction(page, 'rename', event.currentTarget);
                  } else if (['Delete', 'Backspace'].includes(event.key)) {
                    event.preventDefault();
                    if (design.pages.length > 1) beginAction(page, 'delete', event.currentTarget);
                  } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? design.pages.length - 1
                          : Math.max(
                              0,
                              Math.min(
                                design.pages.length - 1,
                                index + (event.key === 'ArrowUp' ? -1 : 1),
                              ),
                            );
                    rows.current
                      ?.querySelectorAll<HTMLButtonElement>('.page-select')
                      [next]?.focus();
                  }
                }}
              >
                <File aria-hidden="true" />
                <span>{page.name}</span>
              </button>
              <button
                className="page-actions icon-button"
                aria-label={`Page actions for ${page.name}`}
                aria-haspopup="menu"
                aria-expanded={menu?.id === page.id}
                onPointerDown={(event) => {
                  if (menu?.id === page.id) event.preventDefault();
                }}
                onClick={(event) => {
                  if (menu?.id === page.id) closeMenu();
                  else showMenu(page, event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    showMenu(page, event.currentTarget);
                  }
                }}
              >
                <MoreHorizontal />
              </button>
            </div>
          ))}
        </div>
      )}
      {expanded && menu && menuPage && (
        <div
          ref={menuElement}
          className="page-action-menu"
          role="menu"
          aria-label={`Actions for ${menuPage.name}`}
          style={{ left: menu.x, top: menu.y }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              if (event.key === 'Escape') event.preventDefault();
              closeMenu();
            } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ];
              const index = items.indexOf(window.document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
              items[next]?.focus();
            }
          }}
        >
          <button role="menuitem" tabIndex={-1} onClick={() => beginAction(menuPage, 'rename')}>
            <Pencil /> Rename page
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            disabled={menuIndex === 0}
            onClick={() => {
              commit((current) => movePage(current, menuPage.id, menuIndex - 1));
              closeMenu();
            }}
          >
            <ArrowUp /> Move up
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            disabled={menuIndex === design.pages.length - 1}
            onClick={() => {
              commit((current) => movePage(current, menuPage.id, menuIndex + 1));
              closeMenu();
            }}
          >
            <ArrowDown /> Move down
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            className="delete-page-action"
            disabled={design.pages.length === 1}
            title={design.pages.length === 1 ? 'Keep at least one page in the document' : undefined}
            onClick={() => beginAction(menuPage, 'delete')}
          >
            <Trash2 /> Delete page
          </button>
        </div>
      )}
      {action &&
        actionPage &&
        createPortal(
          <Modal
            title={action.type === 'rename' ? 'Rename page' : 'Delete page'}
            close={closeAction}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveAction();
              }}
            >
              <div className="modal-body page-action-body">
                {action.type === 'rename' ? (
                  <label>
                    Page name
                    <input
                      ref={nameInput}
                      value={name}
                      maxLength={256}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => {
                        setName(event.target.value);
                        setError('');
                      }}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'page-action-error' : undefined}
                    />
                  </label>
                ) : (
                  <p>
                    Delete “{actionPage.name}” and all its layers? You can undo this while the file
                    is open.
                  </p>
                )}
                {error && (
                  <p id="page-action-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
              <footer className="modal-footer">
                <button type="button" className="secondary-button" onClick={closeAction}>
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  {action.type === 'rename' ? 'Save page name' : 'Delete page'}
                </button>
              </footer>
            </form>
          </Modal>,
          window.document.body,
        )}
    </section>
  );
}
