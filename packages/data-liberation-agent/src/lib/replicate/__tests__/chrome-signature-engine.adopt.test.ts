import { describe, expect, it } from 'vitest';
import {
  canonicalizeInstanceIds,
  chromeSignature,
  stripActiveNavState,
} from '@automattic/blocks-engine/theme';

describe('blocks-engine chrome signature adoption', () => {
  it('strips active nav state with the DLA golden output', () => {
    expect(
      stripActiveNavState(
        '<a href="/" data-selected="true" aria-current="page" data-interactive="false" selected="true" data-selectedness="true" data-state="data-selected">Home</a>'
      )
    ).toBe(
      '<a href="/" data-interactive="true" selected="true" data-selectedness="true" data-state="data-selected">Home</a>'
    );
  });

  it('canonicalizes Wix instance ids in first-appearance order', () => {
    expect(
      canonicalizeInstanceIds(
        '<header id="comp-head1_r_comp-header"><a id="comp-link1_r_comp-nav" data-ref="comp-head1"></a><span id="_r_comp-head1"></span></header>'
      )
    ).toBe(
      '<header id="comp-INSTANCE0_r_comp-header"><a id="comp-INSTANCE1_r_comp-nav" data-ref="comp-INSTANCE0"></a><span id="_r_comp-head1"></span></header>'
    );
  });

  it('does not shear longer alphanumeric tokens that share a prefix', () => {
    expect(
      canonicalizeInstanceIds(
        'comp-aa comp-aa1 comp-aa_r_comp-shared comp-aa1_r_comp-shared _r_comp-aa'
      )
    ).toBe(
      'comp-INSTANCE0 comp-INSTANCE1 comp-INSTANCE0_r_comp-shared comp-INSTANCE1_r_comp-shared _r_comp-aa'
    );
  });

  it('keeps chrome signatures stable across active-nav markers and per-page ids', () => {
    const headerA =
      '<header id="comp-head1_r_comp-header"><nav><a id="comp-home1_r_comp-link" href="/" data-selected="true" aria-current="page" data-interactive="false">Home</a><a id="comp-about1_r_comp-link" href="/about" data-interactive="true">About</a></nav></header>';
    const footerA = '<footer id="comp-foot1_r_comp-footer"><p>Acme</p></footer>';
    const headerB =
      '<header id="comp-head2_r_comp-header"><nav><a id="comp-home2_r_comp-link" href="/" data-interactive="true">Home</a><a id="comp-about2_r_comp-link" href="/about" data-selected="true" aria-current="page" data-interactive="false">About</a></nav></header>';
    const footerB = '<footer id="comp-foot2_r_comp-footer"><p>Acme</p></footer>';

    const expected =
      '<header id="comp-INSTANCE0_r_comp-header"><nav><a id="comp-INSTANCE1_r_comp-link" href="/" data-interactive="true">Home</a><a id="comp-INSTANCE2_r_comp-link" href="/about" data-interactive="true">About</a></nav></header>\u0001<footer id="comp-INSTANCE3_r_comp-footer"><p>Acme</p></footer>';

    expect(chromeSignature(headerA, footerA)).toBe(expected);
    expect(chromeSignature(headerB, footerB)).toBe(expected);
  });
});
