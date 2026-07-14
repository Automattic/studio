import { describe, it, expect } from 'vitest';
import { NEW_TOOL_SCHEMAS } from './tool-schemas.js';

describe('new tool contracts', () => {
  it('locks the agent-facing tool surface (update the snapshot deliberately)', () => {
    expect(NEW_TOOL_SCHEMAS).toMatchSnapshot();
  });
  it('exposes exactly the four new tools', () => {
    expect(Object.keys(NEW_TOOL_SCHEMAS).sort()).toEqual([
      'liberate_cluster_pages', 'liberate_compose_instantiate',
      'liberate_section_extract', 'liberate_validate_artifacts',
    ]);
  });
});
