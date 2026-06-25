//
// Form blocks — captured form → jetpack/contact-form markup
// ==========================================================
// Pure mapper from a captured `SectionSpecForm` (section-extract.ts) to
// Jetpack Forms block markup, so a source site's form reconstructs as a LIVE
// form (submissions land in the local feedback CPT) instead of a dead
// core/html island posting to the defunct source backend.
//
// Grammar notes (verified against current Jetpack, packages/forms/src/blocks):
//   - The container is `jetpack/contact-form`; its save output wraps inner
//     blocks in `<div class="wp-block-jetpack-contact-form">`.
//   - Field blocks are SELF-CLOSING comments (`<!-- wp:jetpack/field-* {...} /-->`);
//     the blocks are server-rendered, so all data rides in the comment attrs.
//   - The submit is a `core/button` (`tagName:"button"`, `type:"submit"`,
//     className `form-button-submit is-submit`) INSIDE the form wrapper — this
//     is EXACTLY what the current Jetpack form editor inserts (jetpack-forms
//     dist/blocks/editor.js: `["core/button",{tagName:"button",type:"submit",
//     className:"form-button-submit is-submit",...}]`; the form-editor's
//     allowed-blocks list annotates core/button "Used for the submit button"
//     and jetpack/button "previously"). The label rides in the saved inner
//     HTML (core/button `text` is HTML-sourced, never a comment attr).
//     NOT `jetpack/button`: that block lives in Jetpack's connection-gated
//     extensions loader and is UNREGISTERED on unconnected installs — an
//     attrs-only self-closing `wp:jetpack/button` then renders to nothing, the
//     form misses the `wp-block-button` marker, and Contact_Form falls back to
//     a server-built legacy button labeled "Submit" (the captured label is
//     lost). Contact_Form::prepare_submit_button wires the interactivity attrs
//     onto any `<button type="submit">`/`.is-submit`, so the core/button
//     submit triggers the Jetpack handler. Side-by-side fields use the field
//     `width` attr (25|50|75|100) — NEVER `wp:columns`.
//   - `number` → `jetpack/field-number`: the block exists in current Jetpack
//     (forms blocks README lists it). We auto-install CURRENT Jetpack via
//     ensurePlugin, so the older-versions gap doesn't apply here.
//   - A captured `checkbox` WITH `options` is a collapsed same-name checkbox
//     GROUP (buildSectionForms) — that maps to `jetpack/field-checkbox-multiple`
//     (Jetpack's checkbox-group block); the single-box `jetpack/field-checkbox`
//     has no options grammar and would lose the choices.
//   - `file` is SKIPPED (Jetpack's field-file has paid-plan requirements) and
//     `hidden` is SKIPPED (no UI; nothing visible to reproduce). Both are
//     returned in `skipped` so the caller can record provenance flags.
//   - `radio`/`select` use the long-standing `options` ATTR grammar (the plan's
//     mapping). Newer Jetpack editors migrate it to inner option blocks on
//     first edit; the server render accepts the attr form.
//
import type { SectionSpecForm, SectionSpecFormField } from './section-extract.js';

export interface FormBlocksResult {
  /** jetpack/contact-form block markup (wrapper + field blocks + submit button). */
  markup: string;
  /** Captured fields that have no in-scope Jetpack equivalent (file, hidden). */
  skipped: Array<{ kind: SectionSpecFormField['kind']; label: string }>;
}

/** Field kinds the mapper deliberately does NOT emit (see grammar notes). */
export const SKIPPED_FIELD_KINDS: ReadonlySet<SectionSpecFormField['kind']> = new Set(['file', 'hidden']);

/** kind → jetpack block name for the simple (no-options) field kinds. */
const FIELD_BLOCK_BY_KIND: Partial<Record<SectionSpecFormField['kind'], string>> = {
  text: 'jetpack/field-text',
  name: 'jetpack/field-name',
  email: 'jetpack/field-email',
  tel: 'jetpack/field-telephone',
  url: 'jetpack/field-url',
  number: 'jetpack/field-number',
  date: 'jetpack/field-date',
  textarea: 'jetpack/field-textarea',
  radio: 'jetpack/field-radio',
  select: 'jetpack/field-select',
  consent: 'jetpack/field-consent',
};

/**
 * Serialize block comment attrs exactly like @wordpress/blocks
 * `serializeAttributes`: JSON with the characters that could terminate the
 * comment delimiter (or smuggle markup) unicode-escaped. Keeps a crafted
 * source label (e.g. containing `-->`) from breaking out of the comment.
 * Exported for variation-hoist, which rewrites existing comment attrs and must
 * not lose this escaping (JSON.parse decodes `--` to literal `--`).
 */
export function serializeBlockAttrs(attrs: Record<string, unknown>): string {
  return JSON.stringify(attrs)
    .replace(/--/g, '\\u002d\\u002d')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\"/g, '\\u0022');
}

/** Escape text for HTML element content (the submit label rides in the
 *  core/button's saved inner HTML, not in comment attrs). */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fieldBlock(f: SectionSpecFormField): string {
  // A captured checkbox carrying options is a collapsed checkbox GROUP.
  const blockName =
    f.kind === 'checkbox'
      ? f.options && f.options.length > 0
        ? 'jetpack/field-checkbox-multiple'
        : 'jetpack/field-checkbox'
      : FIELD_BLOCK_BY_KIND[f.kind];
  if (!blockName) throw new Error(`formToBlocks: unmapped field kind "${f.kind}"`);

  // Only set keys that have values; stable key order keeps output deterministic.
  const attrs: Record<string, unknown> = { label: f.label };
  if (f.required) attrs.required = true;
  if (f.placeholder) attrs.placeholder = f.placeholder;
  if (f.defaultValue) attrs.defaultValue = f.defaultValue;
  if (f.options && f.options.length > 0 && blockName !== 'jetpack/field-checkbox') attrs.options = f.options;
  // width:100 is the Jetpack default — the editor only serializes width when
  // changed, so omitting it matches canonical grammar (and keeps markup clean).
  if (typeof f.widthPct === 'number' && f.widthPct !== 100) attrs.width = f.widthPct;
  if (f.kind === 'consent') attrs.consentType = 'implicit';

  return `<!-- wp:${blockName} ${serializeBlockAttrs(attrs)} /-->`;
}

/**
 * Map one captured form to jetpack/contact-form block markup.
 *
 * Determinism: two calls with the same form are byte-identical (no ids, no
 * randomness — replay-stable per repo conventions).
 */
export function formToBlocks(form: SectionSpecForm): FormBlocksResult {
  const skipped: FormBlocksResult['skipped'] = [];
  const fieldMarkup: string[] = [];
  for (const f of form.fields) {
    if (SKIPPED_FIELD_KINDS.has(f.kind)) {
      skipped.push({ kind: f.kind, label: f.label });
      continue;
    }
    fieldMarkup.push(fieldBlock(f));
  }

  // Submit button: canonical core/button save markup (attr order + classes
  // byte-match @wordpress/blocks serialize(), so the block-fixer round-trip is
  // a no-op and the editor validates it). See grammar notes above for why this
  // is core/button and not jetpack/button.
  const button =
    '<!-- wp:button {"tagName":"button","type":"submit","lock":{"remove":true},"className":"form-button-submit is-submit","metadata":{"name":"Submit button"}} -->\n' +
    `<div class="wp-block-button form-button-submit is-submit"><button type="submit" class="wp-block-button__link wp-element-button">${escapeHtmlText(form.submitLabel)}</button></div>\n` +
    '<!-- /wp:button -->';

  // Wrapper spacing mirrors Jetpack's inserted default (style.spacing only —
  // the design spec confines wrapper styling to spacing).
  const wrapperAttrs = serializeBlockAttrs({
    style: { spacing: { padding: { top: '16px', right: '16px', bottom: '16px', left: '16px' } } },
  });

  const markup =
    `<!-- wp:jetpack/contact-form ${wrapperAttrs} -->\n` +
    `<div class="wp-block-jetpack-contact-form">\n` +
    [...fieldMarkup, button].join('\n') +
    `\n</div>\n` +
    `<!-- /wp:jetpack/contact-form -->`;

  return { markup, skipped };
}
