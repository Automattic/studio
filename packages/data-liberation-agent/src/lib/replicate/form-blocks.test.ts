// Pure mapper: captured SectionSpecForm → jetpack/contact-form block markup.
// All fixture data is fictional.
import { describe, it, expect } from 'vitest';
import { formToBlocks, SKIPPED_FIELD_KINDS } from './form-blocks.js';
import type { SectionSpecForm, SectionSpecFormField } from './section-extract.js';

function field(partial: Partial<SectionSpecFormField> & Pick<SectionSpecFormField, 'kind' | 'label'>): SectionSpecFormField {
  return { required: false, ...partial };
}

function form(fields: SectionSpecFormField[], submitLabel = 'Send'): SectionSpecForm {
  return { fields, submitLabel };
}

/** Check block-comment open/close balance with a stack (handles nesting —
 *  the core/button submit closes inside the still-open contact-form wrapper):
 *  every `<!-- wp:x -->` opener needs a matching `<!-- /wp:x -->` closer;
 *  `<!-- wp:x /-->` is self-contained. */
function assertBalanced(markup: string): void {
  const stack: string[] = [];
  for (const m of markup.matchAll(/<!--\s*(\/)?wp:([a-z0-9/-]+)([^>]*?)(\/)?-->/g)) {
    if (m[1]) expect(stack.pop()).toBe(m[2]);
    else if (m[4] !== '/') stack.push(m[2]);
  }
  expect(stack).toEqual([]);
}

describe('formToBlocks — field kind mapping', () => {
  const KIND_TO_BLOCK: Array<[SectionSpecFormField['kind'], string]> = [
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
  for (const [kind, block] of KIND_TO_BLOCK) {
    it(`${kind} → ${block}`, () => {
      const r = formToBlocks(form([field({ kind, label: 'Fictional label' })]));
      expect(r.markup).toContain(`<!-- wp:${block} `);
      expect(r.markup).toContain('"label":"Fictional label"');
      expect(r.skipped).toEqual([]);
    });
  }

  it('radio with options → jetpack/field-radio with options in source order', () => {
    const r = formToBlocks(form([field({ kind: 'radio', label: 'Size', options: ['Small', 'Large', 'Medium'] })]));
    expect(r.markup).toContain('<!-- wp:jetpack/field-radio ');
    expect(r.markup).toContain('"options":["Small","Large","Medium"]');
  });

  it('select with options → jetpack/field-select with options in source order', () => {
    const r = formToBlocks(form([field({ kind: 'select', label: 'Topic', options: ['Billing', 'Support', 'Other'] })]));
    expect(r.markup).toContain('<!-- wp:jetpack/field-select ');
    expect(r.markup).toContain('"options":["Billing","Support","Other"]');
  });

  it('checkbox GROUP (capture collapses same-name boxes into one field with options) → jetpack/field-checkbox-multiple', () => {
    const r = formToBlocks(form([field({ kind: 'checkbox', label: 'Classes', options: ['Yoga', 'Pilates'] })]));
    expect(r.markup).toContain('<!-- wp:jetpack/field-checkbox-multiple ');
    expect(r.markup).toContain('"options":["Yoga","Pilates"]');
    expect(r.markup).not.toContain('wp:jetpack/field-checkbox {'); // not the single-box block
  });

  it('consent carries consentType implicit', () => {
    const r = formToBlocks(form([field({ kind: 'consent', label: 'I agree to the terms' })]));
    expect(r.markup).toContain('<!-- wp:jetpack/field-consent ');
    expect(r.markup).toContain('"consentType":"implicit"');
  });

  it('file and hidden are SKIPPED and reported (no Jetpack UI equivalent in scope)', () => {
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
});

describe('formToBlocks — attribute presence', () => {
  it('required/placeholder/defaultValue only emitted when set', () => {
    const bare = formToBlocks(form([field({ kind: 'text', label: 'Note' })]));
    expect(bare.markup).not.toContain('"required"');
    expect(bare.markup).not.toContain('"placeholder"');
    expect(bare.markup).not.toContain('"defaultValue"');

    const full = formToBlocks(
      form([field({ kind: 'text', label: 'Note', required: true, placeholder: 'Type here', defaultValue: 'A note' })]),
    );
    expect(full.markup).toContain('"required":true');
    expect(full.markup).toContain('"placeholder":"Type here"');
    expect(full.markup).toContain('"defaultValue":"A note"');
  });

  it('widthPct passes through as the width attr; 100 (Jetpack default) is omitted', () => {
    const r = formToBlocks(
      form([
        field({ kind: 'name', label: 'First', widthPct: 50 }),
        field({ kind: 'name', label: 'Last', widthPct: 50 }),
        field({ kind: 'email', label: 'Email', widthPct: 100 }),
      ]),
    );
    expect(r.markup.match(/"width":50/g)).toHaveLength(2);
    expect(r.markup).not.toContain('"width":100');
  });
});

describe('formToBlocks — submit + wrapper', () => {
  it('submit is a core/button (current Jetpack form-editor grammar) with the captured label in the saved inner HTML; NEVER jetpack/button or wp:columns', () => {
    const r = formToBlocks(form([field({ kind: 'email', label: 'Email' })], 'Request a Quote'));
    // Byte-pin the canonical @wordpress/blocks serialization (attr order + the
    // form-button-submit/is-submit classes Contact_Form keys its interactivity
    // wiring off) so the block-fixer round-trip is a no-op and the editor
    // validates the block. jetpack/button is connection-gated: unregistered on
    // unconnected installs it renders to nothing and the form falls back to a
    // server-built button labeled "Submit", losing the captured label.
    expect(r.markup).toContain(
      '<!-- wp:button {"tagName":"button","type":"submit","lock":{"remove":true},"className":"form-button-submit is-submit","metadata":{"name":"Submit button"}} -->\n' +
        '<div class="wp-block-button form-button-submit is-submit"><button type="submit" class="wp-block-button__link wp-element-button">Request a Quote</button></div>\n' +
        '<!-- /wp:button -->',
    );
    expect(r.markup).not.toContain('jetpack/button');
    expect(r.markup).not.toContain('wp:columns');
  });

  it('wraps fields + button in jetpack/contact-form with the div inner container', () => {
    const r = formToBlocks(form([field({ kind: 'email', label: 'Email' })]));
    expect(r.markup.startsWith('<!-- wp:jetpack/contact-form ')).toBe(true);
    expect(r.markup).toContain('<div class="wp-block-jetpack-contact-form">');
    expect(r.markup.trimEnd().endsWith('<!-- /wp:jetpack/contact-form -->')).toBe(true);
    // Fields sit INSIDE the wrapper.
    expect(r.markup.indexOf('jetpack/field-email')).toBeGreaterThan(r.markup.indexOf('wp-block-jetpack-contact-form'));
    assertBalanced(r.markup);
  });

  it('markup is deterministic (two calls byte-identical) and carries no generated ids', () => {
    const f = form([field({ kind: 'email', label: 'Email' })], 'Go');
    const a = formToBlocks(f);
    const b = formToBlocks(f);
    expect(a.markup).toBe(b.markup);
    expect(a.markup).not.toContain('uniqueId'); // core/button has no id attr to mint
  });

  it('escapes block-comment-hostile attr values (label containing --> cannot break the comment)', () => {
    const r = formToBlocks(form([field({ kind: 'text', label: 'a --> b & <c> "d"' })], 'Send -->'));
    // No premature comment close: every --> in the markup is a delimiter close
    // preceded by a space (comment grammar), never raw inside a JSON string.
    expect(r.markup).not.toContain('--\\u003e'); // double-escape artifact guard
    expect(r.markup).toContain('\\u002d\\u002d'); // `--` escaped per @wordpress/blocks serializeAttributes
    expect(r.markup).toContain('\\u003c');
    expect(r.markup).toContain('\\u0026');
    // The submit label rides in the button's inner HTML — `>` is entity-escaped
    // there so a hostile label can never terminate a following comment.
    expect(r.markup).toContain('>Send --&gt;</button>');
    assertBalanced(r.markup);
  });

  it('markup is balanced for a kitchen-sink form', () => {
    const r = formToBlocks(
      form(
        [
          field({ kind: 'name', label: 'Name', required: true, widthPct: 50 }),
          field({ kind: 'email', label: 'Email', required: true, widthPct: 50 }),
          field({ kind: 'select', label: 'Topic', options: ['A', 'B'] }),
          field({ kind: 'textarea', label: 'Message', placeholder: 'How can we help?' }),
          field({ kind: 'consent', label: 'I agree to the privacy policy' }),
          field({ kind: 'hidden', label: 'Source' }),
        ],
        'Send Message',
      ),
    );
    assertBalanced(r.markup);
    expect(r.skipped).toEqual([{ kind: 'hidden', label: 'Source' }]);
  });
});
