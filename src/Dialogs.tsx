import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Cloud,
  Folder,
  HardDrive,
  Image,
  KeyRound,
  Loader2,
  X,
} from 'lucide-react';
import { defaultSettings, isDesktop, storage } from './storage';
import { exportPageHtml, exportPageSvg } from './model';
import { prepareShaderSnapshots } from './shaders';
import type {
  AppSettings,
  DesignDocument,
  DesignPage,
  DocumentSummary,
  SettingsInput,
} from './types';

export function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
  dismissible = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = container.current!;
    el.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        close();
      }
      if (event.key !== 'Tab') return;
      const fields = [
        ...el.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ];
      const first = fields[0],
        last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    el.addEventListener('keydown', listener);
    return () => {
      el.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, [close, dismissible]);
  return (
    <div
      className="modal-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && dismissible) close();
      }}
    >
      <div
        ref={container}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            disabled={!dismissible}
            onClick={close}
          >
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function SettingsDialog({ close }: { close: () => void }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [tab, setTab] = useState<'storage' | 'image'>('storage');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearCredentials, setClearCredentials] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    storage
      .getSettings()
      .then(setSettings)
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  }, []);
  const field = (group: 'storage' | 'image', key: string, value: string) => {
    setSaved(false);
    setSettings((old) => ({
      ...old,
      [group]: { ...old[group], [key]: value },
    }));
  };
  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    const input: SettingsInput = {
      storage: {
        provider: settings.storage.provider,
        endpoint: settings.storage.endpoint,
        region: settings.storage.region,
        bucket: settings.storage.bucket,
        prefix: settings.storage.prefix,
        ...(accessKeyId ? { accessKeyId } : {}),
        ...(secretAccessKey ? { secretAccessKey } : {}),
        clearCredentials,
      },
      image: {
        endpoint: settings.image.endpoint,
        model: settings.image.model,
        ...(apiKey ? { apiKey } : {}),
        clearApiKey,
      },
    };
    try {
      setSettings(await storage.saveSettings(input));
      setAccessKeyId('');
      setSecretAccessKey('');
      setApiKey('');
      setClearCredentials(false);
      setClearApiKey(false);
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Your workspace, your rules."
      subtitle="Choose where your files live and how you create."
      close={close}
      wide
    >
      <div className="settings-layout">
        <nav className="settings-nav">
          <button className={tab === 'storage' ? 'active' : ''} onClick={() => setTab('storage')}>
            <HardDrive />
            Storage
          </button>
          <button className={tab === 'image' ? 'active' : ''} onClick={() => setTab('image')}>
            <Image />
            Image generation
          </button>
          <div className="settings-private">
            <KeyRound />
            <p>Credentials stay on your device. Never in a design file.</p>
          </div>
        </nav>
        <div className="settings-content">
          {!isDesktop && (
            <div className="notice">
              You're in the browser preview. Local editing works here; open the desktop app to
              configure secure cloud and image providers.
            </div>
          )}
          {tab === 'storage' ? (
            <>
              <h3>File storage</h3>
              <p className="muted">
                Every edit saves locally first. Cloud uploads happen only when you choose “Back up
                to cloud”.
              </p>
              <label className="form-field">
                Provider
                <select
                  aria-label="Storage provider"
                  value={settings.storage.provider}
                  onChange={(event) => field('storage', 'provider', event.target.value)}
                >
                  <option value="local">This device only</option>
                  <option value="s3">Amazon S3 / Cloudflare R2</option>
                </select>
              </label>
              {settings.storage.provider === 'local' ? (
                <div className="local-storage-card">
                  <HardDrive />
                  <div>
                    <strong>A home for your ideas.</strong>
                    <p>
                      {isDesktop
                        ? 'Documents are stored as JSON files in Folio’s application data folder.'
                        : 'Documents are stored in this browser’s IndexedDB. Export a file before clearing browser data.'}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <label className="form-field">
                    Endpoint
                    <input
                      aria-label="S3 endpoint"
                      placeholder="https://<account-id>.r2.cloudflarestorage.com"
                      value={settings.storage.endpoint}
                      onChange={(event) => field('storage', 'endpoint', event.target.value)}
                    />
                    <small>Leave blank for AWS. Use your account endpoint for R2.</small>
                  </label>
                  <div className="form-row">
                    <label className="form-field">
                      Bucket
                      <input
                        aria-label="Bucket"
                        value={settings.storage.bucket}
                        onChange={(event) => field('storage', 'bucket', event.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      Region
                      <input
                        aria-label="Region"
                        value={settings.storage.region}
                        onChange={(event) => field('storage', 'region', event.target.value)}
                      />
                      <small>Use “auto” for R2.</small>
                    </label>
                  </div>
                  <label className="form-field">
                    Folder prefix
                    <input
                      aria-label="Folder prefix"
                      value={settings.storage.prefix}
                      onChange={(event) => field('storage', 'prefix', event.target.value)}
                    />
                  </label>
                  <div className="form-row">
                    <label className="form-field">
                      Access key ID
                      <input
                        autoComplete="off"
                        aria-label="Access key ID"
                        type="password"
                        placeholder={
                          settings.storage.hasCredentials ? 'Securely stored' : 'Enter access key'
                        }
                        value={accessKeyId}
                        onChange={(event) => setAccessKeyId(event.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      Secret access key
                      <input
                        autoComplete="off"
                        aria-label="Secret access key"
                        type="password"
                        placeholder={
                          settings.storage.hasCredentials ? 'Securely stored' : 'Enter secret key'
                        }
                        value={secretAccessKey}
                        onChange={(event) => setSecretAccessKey(event.target.value)}
                      />
                    </label>
                  </div>
                  {settings.storage.hasCredentials && (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={clearCredentials}
                        onChange={(event) => setClearCredentials(event.target.checked)}
                      />
                      Remove saved storage credentials
                    </label>
                  )}
                  <p className="small muted">
                    Backups replace this file’s remote snapshot. This first version doesn’t merge
                    simultaneous edits.
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <h3>Bring your own imagination.</h3>
              <p className="muted">
                Connect an OpenAI-compatible image API. Folio never routes requests through Paper.
              </p>
              <label className="form-field">
                Generation endpoint
                <input
                  aria-label="Image API endpoint"
                  value={settings.image.endpoint}
                  onChange={(event) => field('image', 'endpoint', event.target.value)}
                />
                <small>The complete images/generations endpoint, not just the base URL.</small>
              </label>
              <label className="form-field">
                Model
                <input
                  aria-label="Image model"
                  value={settings.image.model}
                  onChange={(event) => field('image', 'model', event.target.value)}
                />
              </label>
              <label className="form-field">
                API key
                <input
                  autoComplete="off"
                  type="password"
                  aria-label="Image API key"
                  placeholder={
                    settings.image.hasApiKey
                      ? 'Securely stored — leave blank to keep'
                      : 'Enter your provider key'
                  }
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              {settings.image.hasApiKey && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={clearApiKey}
                    onChange={(event) => setClearApiKey(event.target.checked)}
                  />
                  Remove saved image API key
                </label>
              )}
              <div className="notice subtle">
                Your provider may charge for generation. A request is sent only when you click
                Generate in the image dialog.
              </div>
            </>
          )}
          {error && (
            <div role="alert" className="error-message">
              {error}
            </div>
          )}
        </div>
      </div>
      <footer className="modal-footer">
        <span className="muted small">
          {saved ? (
            <>
              <Check size={14} /> Settings saved
            </>
          ) : (
            'No Folio account required.'
          )}
        </span>
        <button
          className="primary-button"
          disabled={busy || !isDesktop}
          onClick={() => void save()}
        >
          {busy ? 'Loading…' : 'Save settings'}
        </button>
      </footer>
    </Modal>
  );
}

export function FilesDialog({
  close,
  open,
  create,
}: {
  close: () => void;
  open: (document: DesignDocument) => Promise<void>;
  create: () => void;
}) {
  const [files, setFiles] = useState<DocumentSummary[]>([]);
  const [source, setSource] = useState<'local' | 'cloud'>('local');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setFiles([]);
    (source === 'local' ? storage.listDocuments() : storage.listCloudDocuments())
      .then((files) => {
        if (active) setFiles(files);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [source]);
  async function load(id: string) {
    setBusy(true);
    setError('');
    try {
      const document = await (source === 'local'
        ? storage.loadDocument(id)
        : storage.loadCloudDocument(id));
      await open(
        source === 'local'
          ? document
          : {
              ...document,
              id: crypto.randomUUID(),
              name: `${document.name} — restored`,
            },
      );
      close();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Your files" subtitle="A space for everything you're working on." close={close}>
      <div className="file-tabs">
        <button className={source === 'local' ? 'active' : ''} onClick={() => setSource('local')}>
          <HardDrive />
          This device
        </button>
        <button className={source === 'cloud' ? 'active' : ''} onClick={() => setSource('cloud')}>
          <Cloud />
          Your bucket
        </button>
      </div>
      <div className="file-list">
        {busy ? (
          <div className="dialog-empty">
            <Loader2 className="spin" />
            Opening your files…
          </div>
        ) : files.length ? (
          files.map((file) => (
            <button className="file-row" key={file.id} onClick={() => void load(file.id)}>
              <span className="file-thumbnail">
                <Folder />
              </span>
              <span>
                <strong>{file.name}</strong>
                <small>
                  {file.pageCount} {file.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                  {new Date(file.updatedAt).toLocaleDateString()}
                </small>
              </span>
              <ArrowUpRight />
            </button>
          ))
        ) : (
          <div className="dialog-empty">
            <Folder />
            <p>
              {source === 'local' ? 'Your next idea starts here.' : 'No cloud snapshots found.'}
            </p>
          </div>
        )}
        {error && (
          <div role="alert" className="error-message">
            {error}
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <span className="muted small">
          {source === 'cloud'
            ? 'Cloud files open as a new local copy.'
            : 'Saved locally. Always yours.'}
        </span>
        <button className="primary-button" onClick={create}>
          New file
        </button>
      </footer>
    </Modal>
  );
}

export function download(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportDialog({
  document: design,
  page,
  close,
}: {
  document: DesignDocument;
  page: DesignPage;
  close: () => void;
}) {
  const [format, setFormat] = useState(
    page.nodes.some((node) => node.shader) ? 'animated-html' : 'png',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [duration, setDuration] = useState('3');
  const [fps, setFps] = useState('24');
  const [progress, setProgress] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run() {
    setBusy(true);
    setError('');
    setDone(false);
    setProgress(0);
    const abort = new AbortController();
    controller.current = abort;
    const name = design.name.replace(/[^a-z0-9 _-]/gi, '').trim() || 'Untitled';
    try {
      if (format === 'animated-html') {
        const { exportAnimatedHtml } = await import('./exports');
        const html = await exportAnimatedHtml(page);
        abort.signal.throwIfAborted();
        download(html, `${name}.animated.html`, 'text/html');
      } else if (format === 'webm') {
        const { exportWebm } = await import('./exports');
        const video = await exportWebm(page, {
          duration: Number(duration),
          fps: Number(fps),
          signal: abort.signal,
          onProgress: setProgress,
        });
        abort.signal.throwIfAborted();
        download(video, `${name}.webm`, 'video/webm');
      } else if (format === 'json')
        download(JSON.stringify(design, null, 2), `${name}.folio.json`, 'application/json');
      else {
        const snapshots = await prepareShaderSnapshots(page);
        abort.signal.throwIfAborted();
        if (format === 'html') {
          download(exportPageHtml(page, snapshots), `${name}.html`, 'text/html');
        } else {
          const svg = exportPageSvg(page, snapshots);
          if (format === 'svg') download(svg, `${name}.svg`, 'image/svg+xml');
          else {
            const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
            try {
              const image = new window.Image();
              image.src = url;
              await image.decode();
              if (
                image.width > 16384 ||
                image.height > 16384 ||
                image.width * image.height > 64000000
              )
                throw new Error(
                  'This page is too large for PNG. Export SVG or reduce its dimensions.',
                );
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              canvas.getContext('2d')!.drawImage(image, 0, 0);
              const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                  (value) => (value ? resolve(value) : reject(new Error('Could not create PNG.'))),
                  'image/png',
                ),
              );
              download(blob, `${name}.png`, 'image/png');
            } finally {
              URL.revokeObjectURL(url);
            }
          }
        }
      }
      setDone(true);
    } catch (cause) {
      setError(
        abort.signal.aborted
          ? 'Export cancelled. Your design is unchanged.'
          : (cause as Error).message,
      );
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Made here. Goes anywhere."
      subtitle={`Export “${page.name}” or take your entire document with you.`}
      close={close}
      dismissible={!busy}
    >
      <div className="modal-body">
        <div className="export-options">
          {[
            ['png', 'PNG image', 'Ready to share'],
            ['svg', 'SVG', 'Scalable shapes & text'],
            ['animated-html', 'Animated HTML', 'Live shaders · works offline'],
            ['webm', 'WebM video', 'A portable motion clip'],
            ['html', 'HTML + CSS', 'Static, script-free web page'],
            ['json', 'Folio document', 'All pages, fully editable'],
          ].map(([value, label, subtitle]) => (
            <button
              key={value}
              disabled={busy}
              className={value === format ? 'active' : ''}
              onClick={() => {
                setFormat(value);
                setDone(false);
              }}
            >
              <span className="format-badge">
                {value === 'animated-html' ? 'LIVE HTML' : value.toUpperCase()}
              </span>
              <strong>{label}</strong>
              <small>{subtitle}</small>
              {value === format && <Check size={14} />}
            </button>
          ))}
        </div>
        {format === 'webm' && (
          <div className="video-export-options">
            <label className="form-field">
              Duration (seconds)
              <input
                aria-label="Video duration"
                type="number"
                min={1}
                max={15}
                step={1}
                value={duration}
                disabled={busy}
                onChange={(event) => setDuration(event.target.value)}
              />
            </label>
            <label className="form-field">
              Frames per second
              <select
                aria-label="Video frame rate"
                value={fps}
                disabled={busy}
                onChange={(event) => setFps(event.target.value)}
              >
                <option value="12">12 fps</option>
                <option value="24">24 fps</option>
                <option value="30">30 fps</option>
              </select>
            </label>
          </div>
        )}
        {page.nodes.some((node) => node.shader) && (
          <p className="small muted">
            Animated HTML includes the shader runtime and plays offline. WebM captures motion. PNG,
            SVG, and HTML + CSS are stills. Folio document keeps every editable effect setting.
          </p>
        )}
        {busy && format === 'webm' && (
          <div className="export-progress" role="status">
            <progress max={1} value={progress} />
            <span>Recording {Math.round(progress * 100)}% · keep this window visible</span>
          </div>
        )}
        {error && (
          <div role="alert" className="error-message">
            {error}
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <span className="muted small">
          {done ? 'Export downloaded.' : 'No credentials are included in exports.'}
        </span>
        {busy && (
          <button className="text-button" onClick={() => controller.current?.abort()}>
            Cancel export
          </button>
        )}
        <button className="primary-button" disabled={busy} onClick={() => void run()}>
          <ArrowDownToLine size={15} />
          {busy ? 'Exporting…' : 'Export file'}
        </button>
      </footer>
    </Modal>
  );
}

export function GenerateDialog({
  close,
  insert,
  settings,
}: {
  close: () => void;
  insert: (src: string) => Promise<void>;
  settings: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="From a thought to an image."
      subtitle="Generated by your provider. Added straight to your canvas."
      close={close}
      dismissible={!busy}
    >
      <div className="modal-body">
        <label className="form-field">
          What do you have in mind?
          <textarea
            autoFocus
            aria-label="Image prompt"
            placeholder="A sculptural paper flower, soft daylight, an olive green background…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            maxLength={4000}
          />
        </label>
        <div className="notice subtle">
          Generating sends this prompt to your configured provider and may incur a charge. Nothing
          is sent to Paper.
        </div>
        {error && (
          <div role="alert" className="error-message">
            {error}
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <button className="text-button" disabled={busy} onClick={settings}>
          Provider settings
        </button>
        <button
          className="primary-button"
          disabled={busy || !prompt.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const { dataUrl } = await storage.generateImage(prompt.trim());
              await insert(dataUrl);
              close();
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Image size={15} />}
          {busy ? 'Generating…' : 'Generate image'}
        </button>
      </footer>
    </Modal>
  );
}
