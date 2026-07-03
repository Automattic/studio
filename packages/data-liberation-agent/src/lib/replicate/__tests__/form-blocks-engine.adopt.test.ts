// Engine adoption guard for captured SectionSpecForm -> Jetpack form blocks.
// Fixture data is fictional.
import { describe, it, expect } from 'vitest';
import { formToBlocks, SKIPPED_FIELD_KINDS } from '@automattic/blocks-engine/theme';
import type { SectionSpecForm, SectionSpecFormField } from '../section-extract.js';

function field(partial: Partial<SectionSpecFormField> & Pick<SectionSpecFormField, 'kind' | 'label'>): SectionSpecFormField {
  return { required: false, ...partial };
}

function form(fields: SectionSpecFormField[], submitLabel = 'Send'): SectionSpecForm {
  return { fields, submitLabel };
}

function assertBalanced(markup: string): void {
  const stack: string[] = [];
  for (const m of markup.matchAll(/<!--\s*(\/)?wp:([a-z0-9/-]+)([^>]*?)(\/)?-->/g)) {
    if (m[1]) expect(stack.pop()).toBe(m[2]);
    else if (m[4] !== '/') stack.push(m[2]);
  }
  expect(stack).toEqual([]);
}

describe('engine formToBlocks adoption', () => {
  it('maps core field kinds to Jetpack field blocks', () => {
    const kindToBlock: Array<[SectionSpecFormField['kind'], string]> = [
      ['text', 'jetpack/field-text'],
      ['name', 'jetpack/field-name'],
      ['email', 'jetpack/field-email'],
      ['tel', 'jetpack/field-telephone'],
      ['url', 'jetpack/field-url'],
      ['number', 'jetpack/field-number'],
      ['date', 'jetpack/field-date'],
      ['textarea', 'jetpack/field-textarea'],
      ['checkbox', 'jetpack/field-checkbox'],
      ['consent', 'jetpack/field-consent'],
    ];

    for (const [kind, block] of kindToBlock) {
      const r = formToBlocks(form([field({ kind, label: 'Fictional label' })]));
      expect(r.markup).toContain(`<!-- wp:${block} `);
      expect(r.markup).toContain('"label":"Fictional label"');
      expect(r.skipped).toEqual([]);
    }
  });

  it('preserves option fields and grouped checkbox choices', () => {
    const r = formToBlocks(
      form([
        field({ kind: 'radio', label: 'Size', options: ['Small', 'Large', 'Medium'] }),
        field({ kind: 'select', label: 'Topic', options: ['Billing', 'Support', 'Other'] }),
        field({ kind: 'checkbox', label: 'Classes', options: ['Yoga', 'Pilates'] }),
      ]),
    );

    expect(r.markup).toContain('<!-- wp:jetpack/field-radio ');
    expect(r.markup).toContain('"options":["Small","Large","Medium"]');
    expect(r.markup).toContain('<!-- wp:jetpack/field-select ');
    expect(r.markup).toContain('"options":["Billing","Support","Other"]');
    expect(r.markup).toContain('<!-- wp:jetpack/field-checkbox-multiple ');
    expect(r.markup).toContain('"options":["Yoga","Pilates"]');
    expect(r.markup).not.toContain('wp:jetpack/field-checkbox {');
  });

  it('reports skipped file and hidden fields', () => {
    const r = formToBlocks(
      form([
        field({ kind: 'file', label: 'Resume upload' }),
        field({ kind: 'hidden', label: 'Campaign id' }),
        field({ kind: 'email', label: 'Email' }),
      ]),
    );

    expect(r.markup).not.toContain('field-file');
    expect(r.markup).not.toContain('hidden');
    expect(r.markup).toContain('jetpack/field-email');
    expect(r.skipped).toEqual([
      { kind: 'file', label: 'Resume upload' },
      { kind: 'hidden', label: 'Campaign id' },
    ]);
    expect(SKIPPED_FIELD_KINDS.has('file')).toBe(true);
    expect(SKIPPED_FIELD_KINDS.has('hidden')).toBe(true);
  });

  it('emits the current Jetpack core/button submit grammar, not jetpack/button', () => {
    const r = formToBlocks(form([field({ kind: 'email', label: 'Email' })], 'Request a Quote'));

    expect(r.markup).toContain(
      '<!-- wp:button {"tagName":"button","type":"submit","lock":{"remove":true},"className":"form-button-submit is-submit","metadata":{"name":"Submit button"}} -->\n' +
        '<div class="wp-block-button form-button-submit is-submit"><button type="submit" class="wp-block-button__link wp-element-button">Request a Quote</button></div>\n' +
        '<!-- /wp:button -->',
    );
    expect(r.markup).not.toContain('jetpack/button');
    expect(r.markup).not.toContain('wp:columns');
  });

  it('matches the pre-strip DLA multi-field golden, including skipped fields', () => {
    const r = formToBlocks(
      form(
        [
          field({ kind: 'name', label: 'Name', required: true, widthPct: 50 }),
          field({ kind: 'email', label: 'Email', required: true, placeholder: 'you@example.com', widthPct: 50 }),
          field({ kind: 'select', label: 'Topic', options: ['Billing', 'Support'] }),
          field({ kind: 'textarea', label: 'Message', defaultValue: 'Hello' }),
          field({ kind: 'consent', label: 'I agree to the privacy policy' }),
          field({ kind: 'file', label: 'Resume upload' }),
          field({ kind: 'hidden', label: 'Campaign id' }),
        ],
        'Send Message',
      ),
    );

    expect(r.markup).toBe(
      '<!-- wp:jetpack/contact-form {"style":{"spacing":{"padding":{"top":"16px","right":"16px","bottom":"16px","left":"16px"}}}} -->\n' +
        '<div class="wp-block-jetpack-contact-form">\n' +
        '<!-- wp:jetpack/field-name {"label":"Name","required":true,"width":50} /-->\n' +
        '<!-- wp:jetpack/field-email {"label":"Email","required":true,"placeholder":"you@example.com","width":50} /-->\n' +
        '<!-- wp:jetpack/field-select {"label":"Topic","options":["Billing","Support"]} /-->\n' +
        '<!-- wp:jetpack/field-textarea {"label":"Message","defaultValue":"Hello"} /-->\n' +
        '<!-- wp:jetpack/field-consent {"label":"I agree to the privacy policy","consentType":"implicit"} /-->\n' +
        '<!-- wp:button {"tagName":"button","type":"submit","lock":{"remove":true},"className":"form-button-submit is-submit","metadata":{"name":"Submit button"}} -->\n' +
        '<div class="wp-block-button form-button-submit is-submit"><button type="submit" class="wp-block-button__link wp-element-button">Send Message</button></div>\n' +
        '<!-- /wp:button -->\n' +
        '</div>\n' +
        '<!-- /wp:jetpack/contact-form -->',
    );
    expect(r.skipped).toEqual([
      { kind: 'file', label: 'Resume upload' },
      { kind: 'hidden', label: 'Campaign id' },
    ]);
  });

  it('matches the pre-strip DLA zero-field golden', () => {
    const r = formToBlocks(form([], 'Submit Now'));

    expect(r.markup).toBe(
      '<!-- wp:jetpack/contact-form {"style":{"spacing":{"padding":{"top":"16px","right":"16px","bottom":"16px","left":"16px"}}}} -->\n' +
        '<div class="wp-block-jetpack-contact-form">\n' +
        '<!-- wp:button {"tagName":"button","type":"submit","lock":{"remove":true},"className":"form-button-submit is-submit","metadata":{"name":"Submit button"}} -->\n' +
        '<div class="wp-block-button form-button-submit is-submit"><button type="submit" class="wp-block-button__link wp-element-button">Submit Now</button></div>\n' +
        '<!-- /wp:button -->\n' +
        '</div>\n' +
        '<!-- /wp:jetpack/contact-form -->',
    );
    expect(r.skipped).toEqual([]);
    assertBalanced(r.markup);
  });

  it('is deterministic and escapes block-comment-hostile attrs', () => {
    const f = form([field({ kind: 'text', label: 'a --> b & <c> "d"' })], 'Send -->');
    const a = formToBlocks(f);
    const b = formToBlocks(f);

    expect(a.markup).toBe(b.markup);
    expect(a.markup).not.toContain('uniqueId');
    expect(a.markup).toContain('\\u002d\\u002d');
    expect(a.markup).toContain('\\u003c');
    expect(a.markup).toContain('\\u0026');
    expect(a.markup).toContain('>Send --&gt;</button>');
    assertBalanced(a.markup);
  });
});
