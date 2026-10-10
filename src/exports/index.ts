import { exportPageHtml } from '../model';
import { renderShaderSnapshot } from '../shaders/snapshots';
import { SHADER_INITIAL_FRAME } from '../shaders/runtime';
import { escapeHtml, exportScene, inertJson, pausedShader } from './scene';
import type { DesignPage } from '../types';

export { exportWebm } from './webm';
export type { WebmExportOptions } from './webm';

export async function exportAnimatedHtml(input: DesignPage): Promise<string> {
  const { page, shaders } = exportScene(input);
  const { default: bundle } = await import('./bundled-runtime');
  const snapshots: Record<string, string> = Object.create(null);
  const frames: Record<string, number> = Object.create(null);
  for (const node of shaders) {
    const paused = pausedShader(node);
    frames[node.id] = paused?.mount.getCurrentFrame() ?? SHADER_INITIAL_FRAME;
    snapshots[node.id] = paused
      ? paused.snapshot()
      : await renderShaderSnapshot(node.shader!, node.width, node.height);
  }
  const html = exportPageHtml(page, snapshots);
  const policy = `default-src 'none'; script-src 'sha256-${bundle.hash}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
  const head = `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><style>${bundle.fonts}\nbody{font-family:Inter,Arial,sans-serif}img[hidden]{display:none!important}</style>`;
  const payload = shaders.map((node) => ({
    id: node.id,
    config: node.shader,
    width: node.width,
    height: node.height,
    frame: frames[node.id],
  }));
  return html
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">${head}`)
    .replace(
      '</body>',
      `<script type="application/json" id="folio-animation-data">${inertJson(payload)}</script><script>${bundle.runtime}</script><template id="folio-export-licenses">${escapeHtml(bundle.notices)}</template></body>`,
    );
}
