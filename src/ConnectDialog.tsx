import { useEffect, useState } from 'react';
import { Check, Code2, Copy, ShieldCheck } from 'lucide-react';
import { Modal } from './Dialogs';
import { isDesktop } from './storage';
import type { useMcp } from './mcp/useMcp';

export function ConnectDialog({
  close,
  mcp,
}: {
  close: () => void;
  mcp: ReturnType<typeof useMcp>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [port, setPort] = useState('3100');
  const [transport, setTransport] = useState<'http' | 'stdio'>('http');
  const [client, setClient] = useState<'generic' | 'vscode' | 'opencode'>('generic');
  useEffect(() => {
    void mcp.refreshStatus().catch((cause: Error) => setError(cause.message));
  }, [mcp.refreshStatus]);
  const endpoint = mcp.status.endpoint ?? `http://127.0.0.1:${port}/mcp`;
  const entry = transport === 'stdio' && mcp.status.stdio ? mcp.status.stdio : { url: endpoint };
  const configuration = JSON.stringify(
    client === 'vscode'
      ? { servers: { folio: { type: transport === 'stdio' ? 'stdio' : 'http', ...entry } } }
      : client === 'opencode'
        ? {
            mcp: {
              folio:
                transport === 'stdio' && mcp.status.stdio
                  ? {
                      type: 'local',
                      command: [mcp.status.stdio.command, ...mcp.status.stdio.args],
                      enabled: true,
                    }
                  : { type: 'remote', url: endpoint, enabled: true },
            },
          }
        : { mcpServers: { folio: entry } },
    null,
    2,
  );
  return (
    <Modal
      title="Your agents. Your canvas."
      subtitle="Let an MCP-compatible agent work with you in Folio."
      close={close}
    >
      <div className="modal-body connect-content">
        <div className="connection-summary">
          <div className="connection-icon">
            <Code2 />
          </div>
          <div>
            <strong>Folio MCP</strong>
            <p>{mcp.status.enabled ? 'Listening on this computer' : 'Off until you enable it'}</p>
          </div>
          <span className={`connection-badge ${mcp.status.enabled ? 'on' : ''}`}>
            {mcp.status.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {!isDesktop ? (
          <div className="notice">
            The browser preview can’t host a local MCP server. Open Folio desktop with Launch
            Folio.cmd to connect your agents.
          </div>
        ) : (
          <>
            <p>
              Agents can read your open file, create and edit layers, import supported HTML, apply
              shaders, and export designs. Changes appear live and can be undone.
            </p>
            <label className="form-field">
              Local port
              <input
                aria-label="MCP port"
                type="number"
                min={1024}
                max={65535}
                value={port}
                disabled={busy || mcp.status.enabled}
                onChange={(event) => setPort(event.target.value)}
              />
            </label>
            {mcp.status.enabled && (
              <>
                <div className="connection-config-options">
                  <div className="segmented-control" role="group" aria-label="MCP transport">
                    <button
                      className={transport === 'http' ? 'active' : ''}
                      aria-pressed={transport === 'http'}
                      onClick={() => {
                        setTransport('http');
                        setCopied(false);
                      }}
                    >
                      HTTP
                    </button>
                    <button
                      className={transport === 'stdio' ? 'active' : ''}
                      aria-pressed={transport === 'stdio'}
                      disabled={!mcp.status.stdio}
                      onClick={() => {
                        setTransport('stdio');
                        setCopied(false);
                      }}
                    >
                      stdio
                    </button>
                  </div>
                  <select
                    aria-label="MCP client"
                    value={client}
                    onChange={(event) => {
                      setClient(event.target.value as typeof client);
                      setCopied(false);
                    }}
                  >
                    <option value="generic">Claude / Cursor / other</option>
                    <option value="vscode">VS Code</option>
                    <option value="opencode">OpenCode</option>
                  </select>
                </div>
                <label className="form-field">
                  Streamable HTTP endpoint
                  <input
                    aria-label="MCP endpoint"
                    readOnly
                    value={mcp.status.endpoint ?? ''}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <div className="config-heading">
                  <strong>Client configuration</strong>
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(configuration);
                        setCopied(true);
                      } catch {
                        setError(
                          'Clipboard access was unavailable. Select and copy the configuration below.',
                        );
                      }
                    }}
                  >
                    {copied ? <Check /> : <Copy />}
                    {copied ? 'Copied' : 'Copy config'}
                  </button>
                </div>
                <textarea
                  className="mcp-config"
                  aria-label="MCP client configuration"
                  readOnly
                  value={configuration}
                  rows={8}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <p className="small muted">
                  {transport === 'stdio'
                    ? 'The adapter runs with Node.js and proxies this enabled local server. Tool discovery works with Folio closed; editing requires Folio open and MCP enabled.'
                    : 'Add this server in your local agent’s MCP settings. The agent must run on this computer; a remote service can’t reach this loopback address.'}
                </p>
              </>
            )}
          </>
        )}
        <div className="connection-security">
          <ShieldCheck />
          <p>
            Local processes can access the open document while enabled. Requests from websites are
            rejected. Provider keys, settings, and arbitrary files are never exposed. Enabling
            resets to off when Folio restarts.
          </p>
        </div>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
      </div>
      <footer className="modal-footer">
        <span className="muted small">No Paper process or account required.</span>
        <button
          className="primary-button"
          disabled={!isDesktop || busy}
          onClick={async () => {
            setError('');
            setBusy(true);
            try {
              if (mcp.status.enabled) await mcp.disable();
              else {
                const value = Number(port);
                if (!Number.isInteger(value) || value < 1024 || value > 65535)
                  throw new Error('Choose a port between 1024 and 65535.');
                await mcp.enable(value);
              }
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Updating…' : mcp.status.enabled ? 'Disable MCP' : 'Enable MCP'}
        </button>
      </footer>
    </Modal>
  );
}
