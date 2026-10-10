import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShaderControls } from '../ShaderControls';
import { ShaderFill } from '../ShaderFill';
import { createShaderConfig } from '../presets';
import type { ShaderConfig, ShaderKind } from '../../types';

export function mountShaderControlsFixture(kind: ShaderKind = 'water') {
  const element = document.createElement('div');
  element.id = 'shader-controls-fixture';
  document.body.append(element);
  const root = createRoot(element);
  function Fixture() {
    const [config, setConfig] = useState<ShaderConfig>(() => createShaderConfig(kind));
    return (
      <div style={{ display: 'flex', gap: 24, padding: 24 }}>
        <ShaderFill config={config} width={360} height={280} />
        <div style={{ width: 300 }}>
          <ShaderControls config={config} onChange={setConfig} />
          <output aria-label="Shader fixture configuration">{JSON.stringify(config)}</output>
        </div>
      </div>
    );
  }
  root.render(<Fixture />);
  return () => { root.unmount(); element.remove(); };
}