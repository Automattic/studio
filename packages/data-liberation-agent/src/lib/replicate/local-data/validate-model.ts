// src/lib/replicate/local-data/validate-model.ts
//
// Validate an agent-authored DataModel before it drives CPT registration + post
// insertion + query-loop injection. Mirrors the gate idea from
// wordpress-block-design-compiler's validateContentModel, adapted to this
// project's DataModel shape (one CPT + one taxonomy + fields + items + mounts +
// card). The converter runs this and, on errors, SKIPS the data path (warn-only,
// never aborts the whole conversion) so a malformed model degrades visibly
// instead of installing a broken type or clobbering content.
import type {
  DataModel,
  DataFieldType,
  DataFieldFormat,
} from './types.js';
import { DATA_MODEL_SCHEMA } from './types.js';

const POST_TYPE_MAX = 20;
const TAXONOMY_MAX = 32;
const FIELD_TYPES: ReadonlySet<DataFieldType> = new Set(['string', 'integer', 'number', 'boolean']);
const FIELD_FORMATS: ReadonlySet<DataFieldFormat> = new Set(['email', 'url', 'textarea', 'date']);
// WordPress built-ins the data path can legitimately TARGET (e.g. the
// static-HTML-card path maps to core post + category). cpt-plugin.ts skips
// registration for exactly these, so naming them is intentional, not a
// collision — must mirror BUILTIN_TYPES / BUILTIN_TAX there.
const USABLE_BUILTIN_TYPES = new Set(['post', 'page', 'attachment']);
const USABLE_BUILTIN_TAXONOMIES = new Set(['category', 'post_tag']);
// Reserved internal types/taxonomies a model can NEVER register or reuse —
// naming one is always an authoring error.
const RESERVED_POST_TYPES = new Set([
  'revision', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part',
]);
const RESERVED_TAXONOMIES = new Set(['nav_menu', 'link_category', 'post_format']);

export interface ValidateModelResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  counts: { fields: number; items: number; terms: number; mounts: number };
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

function checkSlug(value: string, kind: string, max: number, errors: string[]): void {
  if (!value) {
    errors.push(`${kind} slug is required.`);
    return;
  }
  if (value.length > max) errors.push(`${kind} slug "${value}" is ${value.length} chars; WordPress max is ${max}.`);
  if (!SLUG_RE.test(value)) errors.push(`${kind} slug must be lowercase letters/numbers/-/_ : ${value}`);
}

function validateCardTemplateRefs(
  tpl: string,
  maps: Record<string, Record<string, string>>,
  fieldKeys: Set<string>,
  errors: string[],
  warnings: string[],
  label: string
): void {
  for (const mref of tpl.matchAll(/map\.([A-Za-z0-9_]+)\./g)) {
    if (!(mref[1] in maps)) errors.push(`${label} references undefined map: ${mref[1]}`);
  }
  for (const fref of tpl.matchAll(/meta\.([A-Za-z0-9_]+)/g)) {
    if (!fieldKeys.has(fref[1])) warnings.push(`${label} references undeclared meta key: ${fref[1]}`);
  }
}

/**
 * Validate a DataModel. Pure (no IO) — returns errors/warnings/counts. The
 * model is treated as untrusted (agent-authored); every cross-reference is
 * checked so install never silently drops data.
 */
export function validateDataModel(model: DataModel): ValidateModelResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!model || typeof model !== 'object') {
    return { valid: false, errors: ['model is not an object.'], warnings: [], counts: { fields: 0, items: 0, terms: 0, mounts: 0 } };
  }

  if (model.schema !== DATA_MODEL_SCHEMA) {
    warnings.push(`schema is ${model.schema ?? '(absent)'}; current is ${DATA_MODEL_SCHEMA}.`);
  }

  // CPT
  const cpt = model.cpt;
  if (!cpt?.slug) {
    errors.push('cpt.slug is required.');
  } else {
    checkSlug(cpt.slug, 'cpt', POST_TYPE_MAX, errors);
    if (RESERVED_POST_TYPES.has(cpt.slug)) errors.push(`cpt.slug is reserved by WordPress: ${cpt.slug}`);
    else if (USABLE_BUILTIN_TYPES.has(cpt.slug)) warnings.push(`cpt.slug "${cpt.slug}" targets a WordPress built-in type; it will be reused, not registered.`);
  }

  // Taxonomy
  const tax = model.taxonomy;
  const termSlugs = new Set<string>();
  if (!tax?.slug) {
    errors.push('taxonomy.slug is required.');
  } else {
    checkSlug(tax.slug, 'taxonomy', TAXONOMY_MAX, errors);
    if (RESERVED_TAXONOMIES.has(tax.slug)) errors.push(`taxonomy.slug is reserved by WordPress: ${tax.slug}`);
    else if (USABLE_BUILTIN_TAXONOMIES.has(tax.slug)) warnings.push(`taxonomy.slug "${tax.slug}" targets a WordPress built-in taxonomy; it will be reused, not registered.`);
    for (const t of tax.terms ?? []) {
      if (!t.slug) errors.push('taxonomy term is missing a slug.');
      else if (termSlugs.has(t.slug)) errors.push(`duplicate taxonomy term slug: ${t.slug}`);
      termSlugs.add(t.slug);
    }
  }

  // Fields
  const fieldKeys = new Set<string>();
  for (const f of model.fields ?? []) {
    if (!f.key) errors.push('field key is required.');
    else if (!KEY_RE.test(f.key)) errors.push(`field key must be alphanumeric/_/- : ${f.key}`);
    if (fieldKeys.has(f.key)) errors.push(`duplicate field key: ${f.key}`);
    fieldKeys.add(f.key);
    if (!FIELD_TYPES.has(f.type)) errors.push(`field ${f.key} type must be one of ${[...FIELD_TYPES].join(', ')}.`);
    if (f.format && !FIELD_FORMATS.has(f.format)) errors.push(`field ${f.key} format must be one of ${[...FIELD_FORMATS].join(', ')}.`);
    if (f.format && f.type !== 'string') warnings.push(`field ${f.key} has format "${f.format}" but type "${f.type}" (format applies to string fields).`);
  }

  // Items
  const itemIds = new Set<string>();
  for (const it of model.items ?? []) {
    if (!it.id) errors.push('item is missing an id.');
    else if (itemIds.has(it.id)) errors.push(`duplicate item id: ${it.id}`);
    itemIds.add(it.id);
    if (!it.title) warnings.push(`item ${it.id} has no title.`);
    for (const key of Object.keys(it.meta ?? {})) {
      if (!fieldKeys.has(key)) warnings.push(`item ${it.id} sets undeclared meta key: ${key}`);
    }
    for (const term of it.terms ?? []) {
      if (!termSlugs.has(term)) warnings.push(`item ${it.id} references unknown taxonomy term: ${term}`);
    }
  }

  // Mounts
  for (const m of model.mounts ?? []) {
    if (!/^[#.][\w-]+$/.test(m.selector ?? '')) warnings.push(`mount selector is not a simple #id/.class: ${m.selector}`);
    if (cpt?.slug && m.query?.postType && m.query.postType !== cpt.slug) {
      warnings.push(`mount ${m.selector} queries postType "${m.query.postType}" ≠ cpt.slug "${cpt.slug}".`);
    }
    if (m.featured) {
      if (typeof m.featured.columnWrapperClass !== 'string') errors.push(`mount ${m.selector} featured.columnWrapperClass must be a string.`);
      if (!Number.isInteger(m.featured.leadPerPage) || m.featured.leadPerPage < 1) errors.push(`mount ${m.selector} featured.leadPerPage must be a positive integer.`);
      if (!Number.isInteger(m.featured.columnPerPage) || m.featured.columnPerPage < 0) errors.push(`mount ${m.selector} featured.columnPerPage must be a non-negative integer.`);
      if (!m.featured.variant || typeof m.featured.variant !== 'string') errors.push(`mount ${m.selector} featured.variant is required.`);
    }
  }

  // Card template references (every map.<name> and meta.<key> used must exist).
  if (model.card) {
    const maps = model.card.maps ?? {};
    if (model.card.template) validateCardTemplateRefs(model.card.template, maps, fieldKeys, errors, warnings, 'card template');
    if (model.card.variants !== undefined) {
      if (!model.card.variants || typeof model.card.variants !== 'object' || Array.isArray(model.card.variants)) {
        errors.push('card.variants must be an object of template strings.');
      } else {
        for (const [name, tpl] of Object.entries(model.card.variants)) {
          if (typeof tpl !== 'string') {
            errors.push(`card variant ${name} must be a string.`);
            continue;
          }
          validateCardTemplateRefs(tpl, maps, fieldKeys, errors, warnings, `card variant ${name}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts: {
      fields: model.fields?.length ?? 0,
      items: model.items?.length ?? 0,
      terms: tax?.terms?.length ?? 0,
      mounts: model.mounts?.length ?? 0,
    },
  };
}
