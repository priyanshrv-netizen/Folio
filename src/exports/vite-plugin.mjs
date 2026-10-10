import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const require = createRequire(import.meta.url);
const virtualId = 'virtual:folio-export-runtime';
const resolvedId = `\0${virtualId}`;

export function folioExportRuntime() {
  let cached;
  return {
    name: 'folio-offline-export-runtime',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      cached ??= (async () => {
        const bundle = await rolldown({
          input: fileURLToPath(new URL('./offline-runtime.ts', import.meta.url)),
          platform: 'browser',
          onwarn(warning) {
            throw new Error(`Offline export runtime: ${warning.message}`);
          },
        });
        try {
          const result = await bundle.generate({ format: 'iife', minify: true, sourcemap: false });
          if (result.output.length !== 1 || result.output[0].type !== 'chunk')
            throw new Error('Offline exports require exactly one bundled runtime.');
          const runtime = result.output[0].code;
          if (
            result.output[0].imports.length ||
            result.output[0].dynamicImports.length ||
            /<\/script/i.test(runtime)
          )
            throw new Error(
              'The offline runtime contains an unsafe dependency or script terminator.',
            );
          for (const path of Object.keys(result.output[0].modules)) this.addWatchFile(path);
          const shaderRoot = resolve(dirname(require.resolve('@paper-design/shaders')), '..');
          const fontRoot = resolve(dirname(require.resolve('@fontsource/inter/400.css')));
          const fonts = await Promise.all(
            [400, 500, 600, 700].map(async (weight) => {
              const path = resolve(fontRoot, `files/inter-latin-${weight}-normal.woff2`);
              this.addWatchFile(path);
              return `@font-face{font-family:Inter;font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${(await readFile(path)).toString('base64')}) format('woff2')}`;
            }),
          );
          const notices = await Promise.all(
            [resolve(shaderRoot, 'LICENSE'), resolve(fontRoot, 'LICENSE')].map(async (path) => {
              this.addWatchFile(path);
              return readFile(path, 'utf8');
            }),
          );
          return {
            runtime,
            hash: createHash('sha256').update(runtime).digest('base64'),
            fonts: fonts.join('\n'),
            notices: `Paper Shaders (@paper-design/shaders), Apache-2.0. Bundled with Folio's original export adapter.\n${notices[0]}\nInter, SIL Open Font License 1.1.\n${notices[1]}`,
          };
        } finally {
          await bundle.close();
        }
      })().catch((error) => {
        cached = undefined;
        throw error;
      });
      return `export default ${JSON.stringify(await cached)}`;
    },
    watchChange() {
      cached = undefined;
    },
  };
}
