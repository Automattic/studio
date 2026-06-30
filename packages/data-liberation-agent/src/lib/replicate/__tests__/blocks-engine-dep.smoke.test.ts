import { describe, expect, it } from 'vitest';
import {
  canonicalizeInstanceIds,
  chromeSignature,
  stripActiveNavState,
} from '@automattic/blocks-engine/theme';

describe('blocks-engine dependency seam', () => {
  it('resolves theme chrome helpers through DLA tooling', () => {
    const signature: (headerHtml: string, footerHtml: string) => string = chromeSignature;

    expect(typeof signature).toBe('function');
    expect(stripActiveNavState('<a data-selected="true" data-interactive="false" aria-current="page">ABOUT</a>')).toBe(
      '<a data-interactive="true">ABOUT</a>'
    );
    expect(canonicalizeInstanceIds('comp-alpha_r_comp-shared comp-beta')).toBe(
      'comp-INSTANCE0_r_comp-shared comp-INSTANCE1'
    );
    expect(signature('<header id="comp-alpha">Nav</header>', '')).toBe(
      signature('<header id="comp-beta">Nav</header>', '')
    );
  });
});
