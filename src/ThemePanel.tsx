import { useState } from 'react';
import { Check, Grid2X2, Plus, Search, Trash2 } from 'lucide-react';
import type { DesignDocument } from './types';
import { validateDocument } from './model';

export function ThemePanel({
  document,
  commit,
  selected,
}: {
  document: DesignDocument;
  commit: (document: DesignDocument) => void;
  selected: string[];
}) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('#4d94ff');
  const [error, setError] = useState('');
  const tokens = document.tokens ?? [];
  const page = document.pages.find((item) => item.id === document.activePageId)!;
  const selection = page.nodes.filter((node) => selected.includes(node.id) && !node.locked);

  function create() {
    setEditing('new');
    setName(`Color ${tokens.length + 1}`);
    setValue('#4d94ff');
    setError('');
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 128) {
      setError('Give this token a name of 1–128 characters.');
      return;
    }
    if (
      tokens.some(
        (token) => token.id !== editing && token.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      setError('A token with this name already exists.');
      return;
    }
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
      setError('Enter an opaque hex color, such as #4d94ff.');
      return;
    }
    const token = {
      id: editing === 'new' ? crypto.randomUUID() : editing!,
      name: trimmed,
      value: value.trim(),
    };
    try {
      commit(
        validateDocument({
          ...document,
          tokens:
            editing === 'new'
              ? [...tokens, token]
              : tokens.map((item) => (item.id === editing ? token : item)),
        }),
      );
      setEditing(null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The token could not be saved.');
    }
  }

  return (
    <section className="theme-panel" aria-label="Theme tokens">
      <div className="theme-heading">
        <span>
          {tokens.length
            ? `${tokens.length} ${tokens.length === 1 ? 'token' : 'tokens'}`
            : 'No tokens'}
        </span>
        <label className="token-search">
          <Search size={14} />
          <input
            aria-label="Search tokens"
            placeholder="Search tokens"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className="icon-button"
          aria-label="Add theme token"
          disabled={tokens.length >= 256}
          onClick={create}
        >
          <Plus />
        </button>
      </div>
      {!tokens.length && !editing && (
        <div className="empty-theme">
          <Grid2X2 size={32} />
          <h2>Theme tokens</h2>
          <p>
            Create tokens to get started,
            <br />
            or explore the starter theme.
          </p>
          <button className="token-primary" onClick={create}>
            Create token
          </button>
          <button
            className="token-secondary"
            onClick={() =>
              commit({
                ...document,
                tokens: [
                  { id: crypto.randomUUID(), name: 'Background', value: '#ffffff' },
                  { id: crypto.randomUUID(), name: 'Foreground', value: '#202020' },
                  { id: crypto.randomUUID(), name: 'Accent', value: '#4d94ff' },
                ],
              })
            }
          >
            Use starter theme
          </button>
        </div>
      )}
      {tokens.length > 0 && (
        <div className="token-list">
          {tokens
            .filter((token) => token.name.toLowerCase().includes(search.toLowerCase()))
            .map((token) => (
              <div className="token-row" key={token.id}>
                <button
                  className="token-definition"
                  aria-label={`Edit token ${token.name}`}
                  onClick={() => {
                    setEditing(token.id);
                    setName(token.name);
                    setValue(token.value);
                    setError('');
                  }}
                >
                  <span className="token-swatch" style={{ background: token.value }} />
                  <span>
                    {token.name}
                    <small>{token.value}</small>
                  </span>
                </button>
                <button
                  className="icon-button"
                  aria-label={`Apply token ${token.name}`}
                  title="Apply to selected layers"
                  disabled={!selection.length}
                  onClick={() =>
                    commit({
                      ...document,
                      pages: document.pages.map((item) =>
                        item.id !== page.id
                          ? item
                          : {
                              ...item,
                              nodes: item.nodes.map((node) =>
                                selection.some((item) => item.id === node.id)
                                  ? {
                                      ...node,
                                      fill: token.value,
                                      fillTokenId: token.id,
                                      shader: undefined,
                                    }
                                  : node,
                              ),
                            },
                      ),
                    })
                  }
                >
                  <Check />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete token ${token.name}`}
                  onClick={() => {
                    commit({
                      ...document,
                      tokens: tokens.filter((item) => item.id !== token.id),
                      pages: document.pages.map((item) => ({
                        ...item,
                        nodes: item.nodes.map((node) =>
                          node.fillTokenId === token.id
                            ? { ...node, fillTokenId: undefined, fill: token.value }
                            : node,
                        ),
                      })),
                    });
                    if (editing === token.id) setEditing(null);
                  }}
                >
                  <Trash2 />
                </button>
              </div>
            ))}
        </div>
      )}
      {editing && (
        <form
          className="token-editor"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <strong>{editing === 'new' ? 'Create token' : 'Edit token'}</strong>
          <label>
            Name
            <input
              aria-label="Token name"
              autoFocus
              maxLength={128}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Color
            <input
              aria-label="Token color"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div>
            <button type="button" className="token-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="token-primary" type="submit">
              Save token
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
