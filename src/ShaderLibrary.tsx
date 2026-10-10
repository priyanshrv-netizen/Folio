import { ArrowUpRight, Plus, Waves } from 'lucide-react';
import { useState } from 'react';
import { SHADER_CATALOG, SHADER_PRESETS, ShaderFill } from './shaders';
import type { ShaderKind } from './types';

export function ShaderLibrary({
  apply,
  insert,
  playground,
  canApply,
  selectedKind,
}: {
  apply: (kind: ShaderKind) => void;
  insert: (kind: ShaderKind) => void;
  playground: () => void;
  canApply: boolean;
  selectedKind?: ShaderKind;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('featured');
  const presets = SHADER_CATALOG.filter(
    (preset) =>
      (query.trim() ||
        category === 'all' ||
        (category === 'featured'
          ? SHADER_PRESETS.some((featured) => featured.id === preset.id)
          : preset.category === category)) &&
      `${preset.name} ${preset.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="shader-library" role="tabpanel" aria-label="Shaders">
      <div className="library-intro">
        <div className="section-heading">
          <strong>Shader library</strong>
          <span className="library-count">{SHADER_CATALOG.length} effects</span>
        </div>
        <p>{canApply ? 'Choose an effect for your selection.' : 'Add an editable shader layer.'}</p>
      </div>
      <input
        className="shader-search"
        aria-label="Search shaders"
        placeholder="Search effects…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <label className="shader-category-field">
        <span>Collection</span>
        <select
          aria-label="Shader collection"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="featured">Featured</option>
          <option value="all">All effects ({SHADER_CATALOG.length})</option>
          <option value="effect">Effects</option>
          <option value="image-filter">Image filters</option>
          <option value="logo">Logo animations</option>
        </select>
      </label>
      <div className="library-results" aria-live="polite">
        {query.trim() ? `Search results · ${presets.length}` : `${presets.length} shaders`}
        {category === 'featured' && !query.trim() && (
          <button onClick={() => setCategory('all')}>
            View all <ArrowUpRight size={12} />
          </button>
        )}
      </div>
      <div className="shader-grid">
        {presets.map((preset) => (
          <div
            className={`shader-card ${selectedKind === preset.id ? 'active' : ''}`}
            key={preset.id}
          >
            <button
              className="shader-preview-button"
              aria-label={`${canApply ? 'Apply' : 'Insert'} ${preset.name}`}
              title={preset.description}
              onClick={() => (canApply ? apply(preset.id) : insert(preset.id))}
            >
              <span className="shader-card-image">
                <ShaderFill config={preset.config} width={96} height={76} preview />
              </span>
              <span className="shader-card-name">{preset.name}</span>
            </button>
            <button
              className="shader-add"
              aria-label={`Add ${preset.name} layer`}
              title="Add as new layer"
              onClick={() => insert(preset.id)}
            >
              <Plus size={12} />
            </button>
          </div>
        ))}
      </div>
      {!presets.length && <p className="library-empty">No effects match “{query}”.</p>}
      <button className="playground-link" onClick={playground}>
        <Waves />
        <span>
          Open shader playground<small>A new file with editable examples</small>
        </span>
        <ArrowUpRight />
      </button>
      <div className="shader-attribution">
        Powered by Paper Shaders
        <br />
        <span>Open source · Apache 2.0 · Runs locally</span>
      </div>
    </section>
  );
}
