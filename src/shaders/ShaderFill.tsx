import { memo, useEffect, useRef, useState } from 'react';
import type { ShaderConfig } from '../types';
import { liveShaders, renderShaderPreview, renderShaderSnapshot } from './snapshots';
import {
  mountPaperShader,
  shaderConfigKey,
  shaderSpeed,
  waitForShaderPaint,
  type PaperShaderRenderer,
} from './runtime';

export interface ShaderFillProps {
  config: ShaderConfig;
  width: number;
  height: number;
  preview?: boolean;
  nodeId?: string;
}

let liveShaderCount = 0;
const MAX_LIVE_SHADERS = 8;

function ShaderError({ message }: { message: string }) {
  return (
    <div
      className="shader-error"
      role="img"
      aria-label={message}
      title={message}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeContent: 'center',
        padding: 8,
        background: '#251b38',
        color: '#fff',
        fontSize: 11,
        textAlign: 'center',
        lineHeight: 1.4,
        pointerEvents: 'none',
      }}
    >
      <span>Paper shader unavailable</span>
      <span>{message.includes('WebGL') ? 'WebGL2 is required' : 'Unable to render this fill'}</span>
    </div>
  );
}

function ShaderPreview({ config, width, height, preview = true }: ShaderFillProps) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const key = shaderConfigKey(config);
  useEffect(() => {
    let current = true;
    setSource('');
    setError('');
    const render = preview ? renderShaderPreview : renderShaderSnapshot;
    render(config, width, height).then(
      (result) => {
        if (current) setSource(result);
      },
      (cause: Error) => {
        if (current) setError(cause.message);
      },
    );
    return () => {
      current = false;
    };
  }, [key, width, height, preview]);
  return (
    <div
      className="shader-fill shader-preview"
      data-shader-kind={config.kind}
      data-shader-status={error ? 'error' : source ? 'ready' : 'loading'}
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
        pointerEvents: 'none',
        background: config.colors[0],
      }}
    >
      {source && (
        <img
          src={source}
          alt=""
          draggable={false}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
      )}
      {!source && !error && (
        <span className="shader-loading" style={{ color: '#fff', fontSize: 10 }}>
          Rendering Paper shader…
        </span>
      )}
      {!preview && source && (
        <span
          className="shader-static-badge"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            background: '#181329cc',
            color: '#fff',
            borderRadius: 4,
            padding: '3px 5px',
            fontSize: 10,
          }}
        >
          Still · live shader limit
        </span>
      )}
      {error && <ShaderError message={error} />}
    </div>
  );
}

function LiveShaderFill({ config, width, height, nodeId }: ShaderFillProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<PaperShaderRenderer | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [staticFallback, setStaticFallback] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const latest = useRef({ config, width, height, reducedMotion });
  latest.current = { config, width, height, reducedMotion };
  const configKey = shaderConfigKey(config);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(query.matches);
    query.addEventListener('change', change);
    change();
    return () => query.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (liveShaderCount >= MAX_LIVE_SHADERS) {
      setStaticFallback(true);
      return;
    }
    liveShaderCount += 1;
    setStaticFallback(false);
    const controller = new AbortController();
    let mounted: PaperShaderRenderer | undefined;
    const element = host.current!;
    setError('');
    setReady(false);
    const removeRegistration = () => {
      if (nodeId && liveShaders.get(nodeId)?.renderer === mounted) liveShaders.delete(nodeId);
    };
    const lost = () => {
      removeRegistration();
      mounted?.dispose();
      renderer.current = null;
      if (!controller.signal.aborted)
        setError('The WebGL2 context was lost. Reopen this page to retry the Paper shader.');
    };
    void (async () => {
      mounted = await mountPaperShader(
        element,
        latest.current.config,
        latest.current.width,
        latest.current.height,
        controller.signal,
      );
      if (controller.signal.aborted) {
        mounted.dispose();
        return;
      }
      mounted.mount.canvasElement.addEventListener('webglcontextlost', lost);
      renderer.current = mounted;
      const next = latest.current;
      mounted.resize(next.width, next.height);
      mounted.update(next.config, next.reducedMotion);
      await waitForShaderPaint(controller.signal);
      controller.signal.throwIfAborted();
      const current = latest.current;
      if (nodeId)
        liveShaders.set(nodeId, {
          renderer: mounted,
          configKey: shaderConfigKey(current.config),
          width: current.width,
          height: current.height,
        });
      setReady(true);
    })().catch((cause: Error) => {
      mounted?.dispose();
      if (controller.signal.aborted) return;
      removeRegistration();
      renderer.current = null;
      setError(cause.message);
    });
    return () => {
      liveShaderCount -= 1;
      controller.abort();
      removeRegistration();
      mounted?.mount.canvasElement.removeEventListener('webglcontextlost', lost);
      mounted?.dispose();
      renderer.current = null;
    };
  }, [config.kind, config.source, nodeId]);

  useEffect(() => {
    const current = renderer.current;
    if (!current) return;
    try {
      current.resize(width, height);
      current.update(config, reducedMotion);
      if (nodeId && ready) liveShaders.set(nodeId, { renderer: current, configKey, width, height });
    } catch (cause) {
      if (nodeId) liveShaders.delete(nodeId);
      current.dispose();
      renderer.current = null;
      setError(cause instanceof Error ? cause.message : 'Could not update the Paper shader.');
    }
  }, [configKey, width, height, reducedMotion, nodeId, ready]);

  return (
    <div
      className="shader-fill shader-live"
      data-shader-kind={config.kind}
      data-shader-status={staticFallback ? 'static' : error ? 'error' : ready ? 'ready' : 'loading'}
      data-shader-motion={
        staticFallback ||
        reducedMotion ||
        shaderSpeed(config, reducedMotion) === 0
          ? 'paused'
          : 'playing'
      }
      style={{ width, height, position: 'relative', overflow: 'hidden', pointerEvents: 'none' }}
    >
      <div
        ref={host}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      />
      {staticFallback ? (
        <ShaderPreview config={config} width={width} height={height} preview={false} />
      ) : (
        error && <ShaderError message={error} />
      )}
    </div>
  );
}

export const ShaderFill = memo(function ShaderFill(props: ShaderFillProps) {
  return props.preview ? <ShaderPreview {...props} /> : <LiveShaderFill {...props} />;
});
