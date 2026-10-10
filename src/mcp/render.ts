import type { DesignNode, DesignPage, ShaderSnapshots } from '../types';
import { exportPageSvg } from '../model';
import { CommandError } from './errors';

export async function rasterizeImage(source: string, mimeType: 'image/jpeg') {
  if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source))
    throw new CommandError('INVALID_ARGUMENT');
  const image = new Image();
  image.src = source;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CommandError('CAPTURE_FAILED')), 5000);
      }),
    ]);
    const ratio = Math.min(1, 2048 / image.naturalWidth, 2048 / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new CommandError('CAPTURE_FAILED');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const data = canvas.toDataURL(mimeType, 0.9).slice(`data:${mimeType};base64,`.length);
    if (data.length > 6 * 1024 * 1024) throw new CommandError('LIMIT_EXCEEDED');
    return { data, width, height };
  } finally {
    clearTimeout(timer);
  }
}

export async function fontFamilyInfo(familyNames: string[]) {
  if (typeof document === 'undefined') throw new CommandError('NOT_READY');
  const allowed = new Set([
    'Inter',
    'Arial',
    'Helvetica',
    'Verdana',
    'Tahoma',
    'Trebuchet MS',
    'Georgia',
    'Times New Roman',
    'Courier New',
    'system-ui',
    'sans-serif',
    'serif',
    'monospace',
  ]);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new CommandError('NOT_READY');
  return familyNames.map((family) => {
    const supported = allowed.has(family);
    const available =
      supported &&
      (['system-ui', 'sans-serif', 'serif', 'monospace'].includes(family) ||
        ['monospace', 'serif', 'sans-serif'].some((fallback) => {
          context.font = `72px ${fallback}`;
          const baseline = context.measureText('mmWWii00 漢字').width;
          context.font = `72px "${family}", ${fallback}`;
          return context.measureText('mmWWii00 漢字').width !== baseline;
        }));
    return {
      family,
      supported,
      available,
      weights: available ? [100, 200, 300, 400, 500, 600, 700, 800, 900] : [],
      styles: available ? ['normal'] : [],
      weightAvailability:
        'CSS renderable; browser may synthesize weights, not a native font inventory',
    };
  });
}

export function pageJsx(
  page: DesignPage,
  snapshots: ShaderSnapshots = {},
  format: 'inline-styles' | 'tailwind' = 'inline-styles',
): string {
  const bounds = /\bviewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/.exec(
    exportPageSvg(page, snapshots),
  );
  if (!bounds) throw new CommandError('INTERNAL');
  const [left, top, width, height] = bounds.slice(1).map(Number);
  const roots = page.nodes.filter((node) => node.parentId === null);
  const byParent = new Map<string | null, DesignNode[]>();
  for (const node of page.nodes)
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  const render = (node: DesignNode, depth: number): string => {
    if (!node.visible) return '';
    const indent = '  '.repeat(depth);
    const style: Record<string, unknown> = {
      position: 'absolute',
      left: node.x - (node.parentId === null ? left : 0),
      top: node.y - (node.parentId === null ? top : 0),
      width: node.width,
      height: node.height,
      transform: `rotate(${node.rotation}deg)`,
      transformOrigin: 'center center',
      opacity: node.opacity,
      background: node.type === 'text' ? 'transparent' : node.fill,
      color: node.fill,
      borderRadius: node.type === 'ellipse' ? '50%' : node.radius,
      ...(node.type === 'text'
        ? {
            fontFamily: node.fontFamily ?? 'Inter',
            fontSize: node.fontSize ?? 24,
            fontWeight: node.fontWeight ?? 400,
            textAlign: node.textAlign ?? 'left',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            overflow: 'hidden',
            lineHeight: 1.2,
            WebkitTextStroke: `${node.strokeWidth}px ${node.stroke}`,
          }
        : {
            outline: `${node.strokeWidth}px solid ${node.stroke}`,
            outlineOffset: -node.strokeWidth / 2,
          }),
    };
    const src = snapshots[node.id] ?? (node.type === 'image' ? node.src : undefined);
    const image = src
      ? `\n${indent}  <img src={${JSON.stringify(src)}} alt={${JSON.stringify(node.name)}} style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"inherit",position:"absolute",inset:0}} />`
      : '';
    const children = (byParent.get(node.id) ?? [])
      .map((child) => render(child, depth + 1))
      .filter(Boolean)
      .join('\n');
    if (format === 'tailwind') delete style.position;
    return `${indent}<div${format === 'tailwind' ? ' className="absolute"' : ''} data-node-id={${JSON.stringify(node.id)}} aria-label={${JSON.stringify(node.name)}} style={${JSON.stringify(style)}}>${node.type === 'text' ? `{${JSON.stringify(node.text ?? '')}}` : ''}${image}${children ? `\n${children}` : ''}${image || children ? `\n${indent}` : ''}</div>`;
  };
  return `export default function FolioDesign() {\n  return (\n    <div style={{position:"relative",width:${width},height:${height}}}>\n${roots
    .map((node) => render(node, 3))
    .filter(Boolean)
    .join('\n')}\n    </div>\n  );\n}\n`;
}

export async function rasterizeSvg(
  svg: string,
  scale: number,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png',
): Promise<{ data: string; width: number; height: number }> {
  if (typeof document === 'undefined' || typeof Image === 'undefined')
    throw new CommandError('NOT_READY');
  const dimensions = /^<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(svg);
  if (!dimensions) throw new CommandError('CAPTURE_FAILED');
  const sourceWidth = Number(dimensions[1]);
  const sourceHeight = Number(dimensions[2]);
  const ratio = Math.min(scale, 2048 / sourceWidth, 2048 / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  const url = URL.createObjectURL(
    new Blob(
      [
        svg
          .replace(/\bwidth="\d+"/, `width="${width}"`)
          .replace(/\bheight="\d+"/, `height="${height}"`),
      ],
      { type: 'image/svg+xml' },
    ),
  );
  const image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    image.src = url;
    await Promise.race([
      image.decode(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CommandError('CAPTURE_FAILED')), 5000);
      }),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new CommandError('CAPTURE_FAILED');
    if (mimeType === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const encoded = canvas.toDataURL(mimeType, 0.9);
    if (!encoded.startsWith(`data:${mimeType};base64,`)) throw new CommandError('CAPTURE_FAILED');
    const data = encoded.slice(`data:${mimeType};base64,`.length);
    if (data.length > 6 * 1024 * 1024) throw new CommandError('LIMIT_EXCEEDED');
    return { data, width, height };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError('CAPTURE_FAILED');
  } finally {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
}
