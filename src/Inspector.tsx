import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Waves,
  ChevronDown,
  ArrowRight,
  ArrowDown,
  Plus,
  Minus,
  RotateCw,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ShaderControls } from './shaders';
import {
  BLEND_MODES,
  DEFAULT_FILTERS,
  DEFAULT_INNER_SHADOW,
  DEFAULT_SHADOW,
} from './model/appearance';
import type { DesignNode, FrameLayout, NodeShadow } from './types';
import './inspector.css';

export function NumberField({
  label,
  displayLabel = label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 1,
  suffix,
}: {
  label: string;
  displayLabel?: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  return (
    <label className="number-field" title={label}>
      <span aria-hidden="true">{displayLabel}</span>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = Number(draft);
          if (draft.trim() !== '' && Number.isFinite(next)) {
            const clamped = Math.max(min, Math.min(max, next));
            setDraft(String(clamped));
            if (clamped !== value) onChange(clamped);
          } else setDraft(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(value));
            event.stopPropagation();
          }
        }}
      />
      {suffix && (
        <span className="field-suffix" aria-hidden="true">
          {suffix}
        </span>
      )}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
  allowTransparent = true,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  allowTransparent?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const hex = value.slice(1);
  const expanded = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const opacity =
    value === 'transparent' ? 0 : expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1;
  return (
    <div className="color-field">
      <label className="swatch-input" title={label} style={{ background: value }}>
        <input
          type="color"
          aria-label={`${label} color`}
          disabled={!onChange}
          value={value === 'transparent' ? '#ffffff' : `#${expanded.slice(0, 6)}`}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </label>
      <input
        aria-label={`${label} hex`}
        readOnly={!onChange}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const input = draft.trim();
          const normalized = input === 'transparent' ? input : `#${input.replace(/^#/, '')}`;
          if (
            /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized) ||
            (allowTransparent && normalized === 'transparent')
          ) {
            setDraft(normalized);
            if (normalized !== value) onChange?.(normalized);
          } else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            event.stopPropagation();
          }
        }}
      />
      <span>{Math.round(opacity * 100)}%</span>
    </div>
  );
}

function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <details className="inspector-section inspector-disclosure" open>
      <summary>
        <span>{title}</span>
        {actions && <span className="inspector-section-actions">{actions}</span>}
        <ChevronDown size={12} className="section-chevron" />
      </summary>
      {children && <div className="inspector-section-body">{children}</div>}
    </details>
  );
}

function EffectToggle({
  title,
  enabled,
  onClick,
}: {
  title: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="icon-button"
      aria-label={`${enabled ? 'Remove' : 'Add'} ${title.toLowerCase()}`}
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      {enabled ? <Minus /> : <Plus />}
    </button>
  );
}

function ShadowSection({
  title,
  shadow,
  onChange,
  fallback,
}: {
  title: string;
  shadow?: NodeShadow;
  onChange: (shadow: NodeShadow | undefined) => void;
  fallback: NodeShadow;
}) {
  return (
    <Section
      title={title}
      actions={
        <EffectToggle
          title={title}
          enabled={Boolean(shadow)}
          onClick={() => onChange(shadow ? undefined : { ...fallback })}
        />
      }
    >
      {shadow && (
        <>
          <ColorField
            label={title}
            value={shadow.color}
            onChange={(color) => onChange({ ...shadow, color })}
          />
          <div className="field-grid">
            {(['x', 'y', 'blur', 'spread'] as const).map((field) => {
              const label =
                field === 'x' || field === 'y'
                  ? field.toUpperCase()
                  : field[0].toUpperCase() + field.slice(1);
              return (
                <NumberField
                  key={field}
                  label={`${title} ${label}`}
                  displayLabel={label}
                  min={field === 'blur' ? 0 : -1000}
                  max={1000}
                  value={shadow[field]}
                  onChange={(value) => onChange({ ...shadow, [field]: value })}
                />
              );
            })}
          </div>
        </>
      )}
    </Section>
  );
}

interface Props {
  header?: ReactNode;
  node?: DesignNode;
  count: number;
  patch: (patch: Partial<DesignNode>) => void;
  duplicate: () => void;
  remove: () => void;
  reorder: (direction: 'front' | 'back') => void;
  showGrid: boolean;
  setShowGrid: (value: boolean) => void;
  onExport: () => void;
  onShaders: () => void;
  onPlayground: () => void;
  onConnect: () => void;
  canShadeSelection: boolean;
  zoom: number;
  canvasColor: string;
  onCanvasColorChange?: (color: string) => void;
}

export function Inspector({
  header,
  node,
  count,
  patch,
  duplicate,
  remove,
  reorder,
  onExport,
  onShaders,
  onConnect,
  canShadeSelection,
  zoom,
  canvasColor,
  onCanvasColorChange,
}: Props) {
  const [name, setName] = useState(node?.name ?? '');
  useEffect(() => setName(node?.name ?? ''), [node?.name, node?.id]);
  const layout = node?.layout;
  const changeLayout = (value: Partial<FrameLayout>) => {
    if (layout) patch({ layout: { ...layout, ...value } });
  };
  return (
    <aside className="inspector" aria-label="Design inspector">
      {header ?? (
        <div className="panel-tabs">
          <span className="active">Design</span>
          <button onClick={onExport}>Export</button>
          <span className="inspector-zoom">{Math.round(zoom * 100)}%</span>
        </div>
      )}
      {node ? (
        <>
          <Section title="Layout">
            <div className="field-grid geometry-grid">
              <NumberField
                label="X"
                min={-1000000}
                max={1000000}
                value={node.x}
                onChange={(x) => patch({ x })}
              />
              <NumberField
                label="Y"
                min={-1000000}
                max={1000000}
                value={node.y}
                onChange={(y) => patch({ y })}
              />
              <NumberField
                label="Rotation"
                displayLabel={<RotateCw size={12} />}
                suffix="°"
                min={-360}
                max={360}
                value={node.rotation}
                onChange={(rotation) => patch({ rotation })}
              />
            </div>
            <div className="field-grid sizing-grid">
              {(['width', 'height'] as const).map((dimension) => (
                <div className="dimension-field" key={dimension}>
                  <NumberField
                    label={dimension === 'width' ? 'W' : 'H'}
                    min={1}
                    max={100000}
                    value={node[dimension]}
                    onChange={(value) =>
                      patch({
                        [dimension]: value,
                        ...(node.type === 'frame' ? { [`${dimension}Mode`]: 'fixed' } : {}),
                      })
                    }
                  />
                  {node.type === 'frame' && (
                    <select
                      aria-label={`${dimension === 'width' ? 'Width' : 'Height'} sizing`}
                      value={node[`${dimension}Mode`] ?? 'fixed'}
                      onChange={(event) => patch({ [`${dimension}Mode`]: event.target.value })}
                    >
                      <option value="fixed">Fixed</option>
                      <option value="fit" disabled={!layout}>
                        Fit
                      </option>
                    </select>
                  )}
                </div>
              ))}
            </div>
            {node.type === 'frame' && (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={node.clipContent ?? false}
                    onChange={(event) => patch({ clipContent: event.target.checked })}
                  />
                  Clip content
                </label>
                <div className="flex-heading">
                  <span>Flex</span>
                  <button
                    className="icon-button"
                    aria-label={layout ? 'Remove flex layout' : 'Add flex layout'}
                    onClick={() =>
                      patch({
                        layout: layout
                          ? undefined
                          : {
                              direction: 'row',
                              gap: 16,
                              paddingTop: 16,
                              paddingRight: 16,
                              paddingBottom: 16,
                              paddingLeft: 16,
                              align: 'start',
                              justify: 'start',
                            },
                        ...(layout && node.widthMode === 'fit' ? { widthMode: 'fixed' } : {}),
                        ...(layout && node.heightMode === 'fit' ? { heightMode: 'fixed' } : {}),
                      })
                    }
                  >
                    {layout ? <Minus /> : <Plus />}
                  </button>
                </div>
                {layout && (
                  <>
                    <div className="flex-controls">
                      <div className="flex-alignment-grid" role="group" aria-label="Flex alignment">
                        {(['start', 'center', 'end'] as const).flatMap((vertical, row) =>
                          (['start', 'center', 'end'] as const).map((horizontal, column) => {
                            const align = layout.direction === 'row' ? vertical : horizontal;
                            const justify = layout.direction === 'row' ? horizontal : vertical;
                            const label = `${['top', 'center', 'bottom'][row]} ${['left', 'center', 'right'][column]}`;
                            return (
                              <button
                                key={label}
                                aria-label={`Align ${label}`}
                                aria-pressed={layout.align === align && layout.justify === justify}
                                onClick={() => changeLayout({ align, justify })}
                              >
                                <span />
                              </button>
                            );
                          }),
                        )}
                      </div>
                      <div className="flex-main-controls">
                        <div className="segmented-control" role="group" aria-label="Flex direction">
                          <button
                            className={layout.direction === 'row' ? 'active' : ''}
                            aria-label="Horizontal layout"
                            aria-pressed={layout.direction === 'row'}
                            onClick={() => changeLayout({ direction: 'row' })}
                          >
                            <ArrowRight />
                          </button>
                          <button
                            className={layout.direction === 'column' ? 'active' : ''}
                            aria-label="Vertical layout"
                            aria-pressed={layout.direction === 'column'}
                            onClick={() => changeLayout({ direction: 'column' })}
                          >
                            <ArrowDown />
                          </button>
                        </div>
                        <NumberField
                          label="Gap"
                          min={0}
                          value={layout.gap}
                          onChange={(gap) => changeLayout({ gap })}
                        />
                      </div>
                    </div>
                    <div className="field-grid">
                      <select
                        aria-label="Layout alignment"
                        value={layout.align}
                        onChange={(event) =>
                          changeLayout({ align: event.target.value as FrameLayout['align'] })
                        }
                      >
                        <option value="start">Start</option>
                        <option value="center">Center</option>
                        <option value="end">End</option>
                        <option value="stretch">Stretch</option>
                      </select>
                      <select
                        aria-label="Layout distribution"
                        value={layout.justify}
                        onChange={(event) =>
                          changeLayout({ justify: event.target.value as FrameLayout['justify'] })
                        }
                      >
                        <option value="start">Start</option>
                        <option value="center">Center</option>
                        <option value="end">End</option>
                        <option value="space-between">Space between</option>
                      </select>
                    </div>
                    <div className="field-grid padding-grid">
                      {(['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => (
                        <NumberField
                          key={side}
                          label={`Padding ${side.toLowerCase()}`}
                          displayLabel={side}
                          min={0}
                          value={layout[`padding${side}`]}
                          onChange={(value) => changeLayout({ [`padding${side}`]: value })}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </Section>
          <Section title="Radius">
            <div className="radius-control">
              <input
                aria-label="Corner radius"
                type="range"
                min={0}
                max={Math.min(node.width, node.height) / 2}
                value={Math.min(node.radius, Math.min(node.width, node.height) / 2)}
                onChange={(event) => patch({ radius: Number(event.target.value) })}
              />
              <NumberField
                label="Radius"
                displayLabel=""
                min={0}
                max={100000}
                value={node.radius}
                onChange={(radius) => patch({ radius })}
              />
            </div>
          </Section>
          <Section
            title="Blending"
            actions={
              <button
                className="icon-button"
                aria-label={node.visible ? 'Hide selection' : 'Show selection'}
                onClick={(event) => {
                  event.preventDefault();
                  patch({ visible: !node.visible });
                }}
              >
                {node.visible ? <Eye /> : <EyeOff />}
              </button>
            }
          >
            <div className="field-grid">
              <NumberField
                label="Opacity %"
                displayLabel="Opacity"
                suffix="%"
                min={0}
                max={100}
                value={node.opacity * 100}
                onChange={(opacity) => patch({ opacity: opacity / 100 })}
              />
              <select
                aria-label="Blend mode"
                value={node.blendMode ?? 'normal'}
                onChange={(event) =>
                  patch({ blendMode: event.target.value as DesignNode['blendMode'] })
                }
              >
                {BLEND_MODES.map((mode) => (
                  <option value={mode} key={mode}>
                    {mode
                      .split('-')
                      .map((word) => word[0].toUpperCase() + word.slice(1))
                      .join(' ')}
                  </option>
                ))}
              </select>
            </div>
          </Section>
          <Section
            title="Fill"
            actions={
              ['frame', 'rectangle', 'ellipse'].includes(node.type) && (
                <button
                  className="icon-button"
                  aria-label="Choose shader"
                  title="Browse shader library"
                  onClick={(event) => {
                    event.preventDefault();
                    onShaders();
                  }}
                >
                  <Waves />
                </button>
              )
            }
          >
            {node.shader ? (
              <>
                <div className="fill-type-switch" role="group" aria-label="Fill type">
                  <button onClick={() => patch({ shader: undefined })}>Solid</button>
                  <button className="active" aria-pressed="true" onClick={onShaders}>
                    Shader
                  </button>
                </div>
                {canShadeSelection ? (
                  <ShaderControls config={node.shader} onChange={(shader) => patch({ shader })} />
                ) : (
                  <p className="shader-hint">
                    Select only unlocked shapes or artboards to edit their shader fills.
                  </p>
                )}
              </>
            ) : (
              <ColorField
                label="Fill"
                value={node.fill}
                onChange={(fill) => patch({ fill, fillTokenId: undefined })}
              />
            )}
          </Section>
          {node.type === 'text' && (
            <Section title="Typography">
              <select
                aria-label="Font family"
                value={node.fontFamily ?? 'Inter'}
                onChange={(event) => patch({ fontFamily: event.target.value })}
              >
                {['Arial', 'Inter', 'Georgia', 'Times New Roman', 'Courier New', 'system-ui'].map(
                  (font) => (
                    <option key={font}>{font}</option>
                  ),
                )}
              </select>
              <div className="field-grid">
                <select
                  aria-label="Font weight"
                  value={node.fontWeight ?? 400}
                  onChange={(event) => patch({ fontWeight: Number(event.target.value) })}
                >
                  <option value={400}>Regular</option>
                  <option value={500}>Medium</option>
                  <option value={600}>Semibold</option>
                  <option value={700}>Bold</option>
                </select>
                <NumberField
                  label="Size"
                  min={1}
                  max={1000}
                  value={node.fontSize ?? 24}
                  onChange={(fontSize) => patch({ fontSize })}
                />
              </div>
              <div className="segmented-control" role="group" aria-label="Text alignment">
                {(
                  [
                    ['left', AlignLeft],
                    ['center', AlignCenter],
                    ['right', AlignRight],
                  ] as const
                ).map(([align, Icon]) => (
                  <button
                    key={align}
                    aria-label={`Align text ${align}`}
                    aria-pressed={(node.textAlign ?? 'left') === align}
                    className={(node.textAlign ?? 'left') === align ? 'active' : ''}
                    onClick={() => patch({ textAlign: align })}
                  >
                    <Icon />
                  </button>
                ))}
              </div>
              <textarea
                aria-label="Text content"
                className="text-content"
                value={node.text ?? ''}
                onChange={(event) => patch({ text: event.target.value })}
              />
            </Section>
          )}
          <Section
            title="Outline"
            actions={
              <EffectToggle
                title="Outline"
                enabled={node.strokeWidth > 0 && node.stroke !== 'transparent'}
                onClick={() =>
                  patch(
                    node.strokeWidth > 0 && node.stroke !== 'transparent'
                      ? { strokeWidth: 0 }
                      : {
                          strokeWidth: node.strokeWidth || 1,
                          stroke: node.stroke === 'transparent' ? '#000000' : node.stroke,
                        },
                  )
                }
              />
            }
          >
            {node.strokeWidth > 0 && node.stroke !== 'transparent' && (
              <>
                <ColorField
                  label="Stroke"
                  value={node.stroke}
                  onChange={(stroke) => patch({ stroke })}
                />
                <NumberField
                  label="Weight"
                  min={0}
                  max={1000}
                  value={node.strokeWidth}
                  onChange={(strokeWidth) => patch({ strokeWidth })}
                />
              </>
            )}
          </Section>
          <ShadowSection
            title="Shadow"
            shadow={node.shadow}
            fallback={DEFAULT_SHADOW}
            onChange={(shadow) => patch({ shadow })}
          />
          <ShadowSection
            title="Inner shadow"
            shadow={node.innerShadow}
            fallback={DEFAULT_INNER_SHADOW}
            onChange={(innerShadow) => patch({ innerShadow })}
          />
          <Section
            title="Filters"
            actions={
              <EffectToggle
                title="Filters"
                enabled={Boolean(node.filters)}
                onClick={() =>
                  patch({ filters: node.filters ? undefined : { ...DEFAULT_FILTERS } })
                }
              />
            }
          >
            {node.filters && (
              <div className="field-grid filter-fields">
                <NumberField
                  label="Blur"
                  min={0}
                  max={100}
                  value={node.filters.blur}
                  onChange={(blur) => patch({ filters: { ...node.filters!, blur } })}
                />
                {(['brightness', 'contrast', 'saturation'] as const).map((field) => (
                  <NumberField
                    key={field}
                    label={field[0].toUpperCase() + field.slice(1)}
                    suffix="%"
                    min={0}
                    max={400}
                    value={node.filters![field] * 100}
                    onChange={(value) =>
                      patch({ filters: { ...node.filters!, [field]: value / 100 } })
                    }
                  />
                ))}
              </div>
            )}
          </Section>
          <Section
            title="Arrange"
            actions={
              <button
                className="icon-button"
                aria-label={node.locked ? 'Unlock selection' : 'Lock selection'}
                onClick={(event) => {
                  event.preventDefault();
                  patch({ locked: !node.locked });
                }}
              >
                {node.locked ? <Lock /> : <Unlock />}
              </button>
            }
          >
            {count > 1 && <span className="selection-count">{count} layers selected</span>}
            <input
              className="layer-name-input"
              aria-label="Layer name"
              maxLength={256}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                const next = name.trim() || node.type;
                setName(next);
                if (next !== node.name) patch({ name: next });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <div className="action-grid">
              <button onClick={() => reorder('front')}>
                <ArrowUpToLine />
                To front
              </button>
              <button onClick={() => reorder('back')}>
                <ArrowDownToLine />
                To back
              </button>
              <button onClick={duplicate}>
                <Copy />
                Duplicate
              </button>
              <button onClick={remove}>
                <Trash2 />
                Delete
              </button>
            </div>
          </Section>
          <Section title="Export">
            <button className="panel-command" onClick={onExport}>
              Export
            </button>
          </Section>
        </>
      ) : (
        <>
          <section className="inspector-section page-section">
            <div className="section-heading">
              <strong>Page</strong>
            </div>
            <div className="inspector-section-body">
              <ColorField
                label="Page"
                value={canvasColor}
                onChange={onCanvasColorChange}
                allowTransparent={false}
              />
            </div>
          </section>
          <section className="inspector-section page-section">
            <div className="section-heading">
              <strong>MCP</strong>
            </div>
            <div className="inspector-section-body">
              <button className="panel-command" onClick={onConnect}>
                Connect your agent
              </button>
            </div>
          </section>
        </>
      )}
    </aside>
  );
}
