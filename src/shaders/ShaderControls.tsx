import { useEffect, useId, useRef, useState } from 'react';
import { validateShaderConfig } from '../../desktop/persistence/validation.mjs';
import type { ShaderConfig } from '../types';
import { SHADER_DETAIL_LABELS, SHADER_CATALOG } from './presets';
import { shaderDefinition } from './schema.mjs';
import { importShaderSource } from './sources';

function ColorField({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange(value: string): void;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const [focused, setFocused] = useState(false);
  const color =
    value === 'transparent'
      ? '#000000'
      : value.length <= 5
        ? `#${value
            .slice(1, 4)
            .split('')
            .map((digit) => digit + digit)
            .join('')}`
        : value.slice(0, 7);
  return (
    <div className="shader-color-field">
      <input
        className="shader-color-swatch"
        type="color"
        aria-label={`${label} picker`}
        value={color}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        className="shader-color-value"
        type="text"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={focused ? draft : value}
        spellCheck={false}
        maxLength={11}
        onFocus={() => {
          setDraft(value);
          setFocused(true);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={() => {
          const next = draft.trim();
          if (/^(?:transparent|#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8}))$/i.test(next)) {
            onChange(next.toLowerCase());
            setInvalid(false);
          } else setInvalid(true);
          setFocused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </div>
  );
}

export function ShaderControls({
  config,
  onChange,
}: {
  config: ShaderConfig;
  onChange(config: ShaderConfig): void;
}) {
  const id = useId();
  const definition = shaderDefinition(config.kind)!;
  const staticPattern = !definition.animated;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadGeneration = useRef(0);
  const latest = useRef({ config, onChange });
  latest.current = { config, onChange };
  useEffect(() => {
    setUploading(false);
    setUploadError('');
    uploadGeneration.current += 1;
    return () => { uploadGeneration.current += 1; };
  }, [config.kind]);
  const patch = (update: Partial<ShaderConfig>) =>
    onChange(validateShaderConfig({ ...config, ...update }));
  const preset = SHADER_CATALOG.find((item) => item.id === (config.kind === 'smoke-ring' ? 'smoke' : config.kind))!;
  return (
    <div className="shader-controls" aria-label={`${preset.name} shader controls`}>
      <div className="shader-controls-heading">
        <span>{preset.name}</span>
        <span className="shader-powered-by">Paper Shaders</span>
      </div>
      {definition.supportsImage && (
        <div className="shader-image-control">
          <label className="shader-image-label" htmlFor={`${id}-source`}>Shader source image</label>
          {config.source && <img className="shader-source-preview" src={config.source} alt="Current shader source" style={{ width: '100%', maxHeight: 120, objectFit: 'contain' }} />}
          <input
            id={`${id}-source`}
            className="shader-image-input"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={uploading}
            aria-describedby={`${id}-source-help${uploadError ? ` ${id}-source-error` : ''}`}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              const generation = ++uploadGeneration.current;
              const kind = config.kind;
              setUploadError('');
              setUploading(true);
              try {
                const source = await importShaderSource(file);
                if (generation !== uploadGeneration.current || latest.current.config.kind !== kind) return;
                latest.current.onChange(validateShaderConfig({ ...latest.current.config, source }));
              } catch (cause) {
                if (generation === uploadGeneration.current)
                  setUploadError(cause instanceof Error ? cause.message : 'The image could not be imported.');
              } finally {
                if (generation === uploadGeneration.current) setUploading(false);
              }
            }}
          />
          <p className="shader-hint" id={`${id}-source-help`}>
            PNG, JPEG, GIF, or WebP, up to 10 MiB. Embedded locally; resized to 1536 px.
            {config.kind === 'heatmap' ? ' Use a dark logo on white or a transparent background.'
              : definition.category === 'logo' ? ' Use a logo with a transparent background.' : ''}
          </p>
          {uploading && <p className="shader-hint" role="status">Preparing shader image…</p>}
          {uploadError && <p className="shader-upload-error" role="alert" id={`${id}-source-error`}>{uploadError}</p>}
          {config.source ? (
            <button className="shader-reset-source" type="button" onClick={() => { setUploadError(''); patch({ source: undefined }); }}>
              Use default source
            </button>
          ) : <p className="shader-hint">Using the built-in {definition.category === 'logo' ? 'logo shape' : 'landscape demo'}. No external image requests.</p>}
        </div>
      )}
      {definition.palette !== 'none' && <div className="shader-palette" role="group" aria-label="Shader color palette">
        {config.colors.map((color, index) => (
          <label className="shader-palette-item" key={index}>
            <span>
              {definition.colorLabels?.[index] ?? (definition.palette === 'all'
                ? `Color ${index + 1}`
                : index === 0 ? 'Background' : `Color ${index}`)}
            </span>
            <ColorField
              value={color}
              label={`Shader color ${index + 1}`}
              onChange={(value) =>
                patch({
                  colors: config.colors.map((old, position) => (position === index ? value : old)),
                })
              }
            />
          </label>
        ))}
      </div>}
      {!staticPattern && (
        <>
          <div className="shader-control-row">
            <label htmlFor={`${id}-speed`}>Speed</label>
            <output htmlFor={`${id}-speed`}>{config.speed.toFixed(2)}×</output>
          </div>
          <input
            id={`${id}-speed`}
            className="shader-range"
            type="range"
            min="0"
            max="3"
            step="0.05"
            value={config.speed}
            onChange={(event) => patch({ speed: Number(event.target.value) })}
          />
          <button
            className="shader-pause-button"
            type="button"
            aria-pressed={config.paused}
            onClick={() => patch({ paused: !config.paused })}
          >
            {config.paused ? 'Play animation' : 'Pause animation'}
          </button>
        </>
      )}
      {staticPattern && <p className="shader-hint">{preset.name} is a static Paper shader pattern.</p>}
      <div className="shader-control-row">
        <label htmlFor={`${id}-scale`}>Scale</label>
        <output htmlFor={`${id}-scale`}>{config.scale.toFixed(2)}×</output>
      </div>
      <input
        id={`${id}-scale`}
        className="shader-range"
        type="range"
        min="0.25"
        max="4"
        step="0.05"
        value={config.scale}
        onChange={(event) => patch({ scale: Number(event.target.value) })}
      />
      <div className="shader-control-row">
        <label htmlFor={`${id}-detail`}>{SHADER_DETAIL_LABELS[config.kind]}</label>
        <output htmlFor={`${id}-detail`}>{Math.round(config.detail * 100)}%</output>
      </div>
      <input
        id={`${id}-detail`}
        className="shader-range"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={config.detail}
        onChange={(event) => patch({ detail: Number(event.target.value) })}
      />
      <details className="shader-advanced-controls">
        <summary>Effect settings</summary>
        {Object.entries(definition.parameters).map(([name, parameter]) => {
          const value = config.parameters?.[name] ?? parameter.default;
          const fieldId = `${id}-parameter-${name}`;
          const change = (next: number | boolean) => patch({ parameters: { ...config.parameters, [name]: next } });
          if (parameter.type === 'boolean') return (
            <label className="shader-toggle-control" key={name} htmlFor={fieldId}>
              <input id={fieldId} type="checkbox" checked={Boolean(value)} onChange={(event) => change(event.target.checked)} />
              {parameter.label}
            </label>
          );
          if (parameter.options) return (
            <label className="shader-select-control" key={name} htmlFor={fieldId}>
              <span>{parameter.label}</span>
              <select id={fieldId} value={Number(value)} onChange={(event) => change(Number(event.target.value))}>
                {parameter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          );
          return (
            <div className="shader-parameter-control" key={name}>
              <div className="shader-control-row">
                <label htmlFor={fieldId}>{parameter.label}</label>
                <output htmlFor={fieldId}>{Number(value).toFixed(parameter.step === 1 ? 0 : parameter.step === 0.001 ? 3 : 2)}</output>
              </div>
              <input id={fieldId} className="shader-range" type="range" min={parameter.min} max={parameter.max} step={parameter.step} value={Number(value)} onChange={(event) => change(Number(event.target.value))} />
            </div>
          );
        })}
      </details>
      <p className="shader-hint">
        Motion respects your system preference. SVG and PNG capture a still; .folio files keep
        the editable shader and embedded source image.
      </p>
    </div>
  );
}
