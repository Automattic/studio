import { describe, it, expect } from 'vitest';
import { composeInstantiate } from './compose-instantiate.js';

const skeleton = {
  sections: [{ type: 'cover-with-headline', slots: ['HEADING', 'SUBHEADING'] }],
};

describe('composeInstantiate', () => {
  it('fills known slots from page content', () => {
    const r = composeInstantiate(skeleton, { HEADING: 'Hello', SUBHEADING: 'World' }, {});
    expect(r.misfit).toBe(false);
    expect(r.postContent).toContain('Hello');
    expect(r.postContent).toContain('World');
    expect(r.sanity.unfilledSlots).toEqual([]);
  });

  it('flags a misfit when a slot has no content', () => {
    const r = composeInstantiate(skeleton, { HEADING: 'Hello' }, {});
    expect(r.misfit).toBe(true);
    expect(r.sanity.unfilledSlots).toContain('SUBHEADING');
  });

  it('flags a misfit when page has extra sections the skeleton lacks', () => {
    const r = composeInstantiate(skeleton, { HEADING: 'H', SUBHEADING: 'S', __extraSections: 1 } as any, {});
    expect(r.misfit).toBe(true);
    expect(r.sanity.sectionCountMismatch).toBe(true);
  });
});
