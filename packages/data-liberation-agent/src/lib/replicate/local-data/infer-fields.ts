import type { DataField, DataFieldType, DataFieldFormat } from './types.js';

type Rec = Record<string, unknown>;
export type RoleConfidence = 'high' | 'low';

export interface InferredFields {
  idKey: string;
  titleKey: string;
  contentKey?: string;
  termKey?: string;
  galleryKey?: string;
  fields: DataField[];
  confidence: { id: RoleConfidence; title: RoleConfidence; terms: RoleConfidence };
}

const TITLE_NAMES = ['title', 'name', 'label', 'heading'];
const CONTENT_NAMES = ['content', 'story', 'description', 'body', 'excerpt'];
const TERM_NAMES = ['category', 'cat', 'kind', 'type', 'collection', 'group'];
const GALLERY_NAMES = ['images', 'gallery', 'photos', 'media'];
const CONTENT_MIN_LEN = 60;

const keysOf = (records: Rec[]): string[] => [...new Set(records.flatMap((record) => Object.keys(record)))];
const values = (records: Rec[], key: string): unknown[] => records.map((record) => record[key]).filter((value) => value !== undefined);
const allScalar = (valuesForKey: unknown[]): boolean =>
  valuesForKey.length > 0 && valuesForKey.every((value) => typeof value === 'string' || typeof value === 'number');
const allStrings = (valuesForKey: unknown[]): boolean => valuesForKey.length > 0 && valuesForKey.every((value) => typeof value === 'string');
const allUnique = (valuesForKey: unknown[]): boolean => new Set(valuesForKey).size === valuesForKey.length;
const pick = (keys: string[], names: string[]): string | undefined => keys.find((key) => names.includes(key.toLowerCase()));

function avgLen(records: Rec[], key: string): number {
  const stringValues = values(records, key).filter((value) => typeof value === 'string') as string[];
  return stringValues.length ? stringValues.reduce((sum, value) => sum + value.length, 0) / stringValues.length : 0;
}

function isGalleryVal(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => {
    return typeof entry === 'string' || Boolean(entry && typeof entry === 'object' && ('caption' in entry || 'url' in entry));
  });
}

function coarseType(valuesForKey: unknown[]): DataFieldType {
  if (valuesForKey.every((value) => typeof value === 'boolean')) return 'boolean';
  if (valuesForKey.every((value) => typeof value === 'number')) {
    return valuesForKey.every((value) => Number.isInteger(value)) ? 'integer' : 'number';
  }
  return 'string';
}

function detectFormat(valuesForKey: unknown[]): DataFieldFormat | undefined {
  const stringValues = valuesForKey.filter((value) => typeof value === 'string') as string[];
  if (stringValues.length === 0) return undefined;
  if (stringValues.every((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))) return 'email';
  if (stringValues.every((value) => /^https?:\/\//.test(value))) return 'url';
  if (stringValues.every((value) => /^\d{4}-\d{2}-\d{2}/.test(value))) return 'date';
  if (stringValues.some((value) => value.length >= CONTENT_MIN_LEN)) return 'textarea';
  return undefined;
}

function fieldFor(records: Rec[], key: string): DataField {
  const valuesForKey = values(records, key);
  const type = coarseType(valuesForKey);
  const format = type === 'string' ? detectFormat(valuesForKey) : undefined;
  return format ? { key, type, format } : { key, type };
}

export function inferFields(records: Rec[]): InferredFields {
  const keys = keysOf(records);

  let idKey = pick(keys, ['id', 'slug']) ?? keys[0] ?? 'id';
  let idConf: RoleConfidence = 'low';
  if (pick(keys, ['id', 'slug']) && allScalar(values(records, idKey)) && allUnique(values(records, idKey))) {
    idConf = 'high';
  }

  let titleKey = pick(keys, TITLE_NAMES);
  let titleConf: RoleConfidence = titleKey ? 'high' : 'low';
  if (!titleKey) {
    titleKey = keys
      .filter((key) => key !== idKey && allStrings(values(records, key)))
      .sort((a, b) => avgLen(records, a) - avgLen(records, b))[0] ?? idKey;
  }

  const contentKey = pick(keys, CONTENT_NAMES) ??
    keys.find((key) => key !== titleKey && allStrings(values(records, key)) && avgLen(records, key) >= CONTENT_MIN_LEN);

  let termKey = pick(keys, TERM_NAMES);
  let termsConf: RoleConfidence = termKey ? 'high' : 'low';
  if (!termKey) {
    termKey = keys.find((key) => {
      const valuesForKey = values(records, key);
      return key !== idKey &&
        key !== titleKey &&
        allStrings(valuesForKey) &&
        new Set(valuesForKey).size <= Math.max(1, Math.floor(valuesForKey.length / 2));
    });
    if (termKey) termsConf = 'low';
  }

  const galleryKey = pick(keys, GALLERY_NAMES) ?? keys.find((key) => {
    const valuesForKey = values(records, key);
    return valuesForKey.length > 0 && valuesForKey.every(isGalleryVal);
  });

  const roleKeys = new Set<string>();
  if (idConf === 'high') roleKeys.add(idKey);
  if (titleConf === 'high') roleKeys.add(titleKey);
  if (contentKey) roleKeys.add(contentKey);
  if (termKey && termsConf === 'high') roleKeys.add(termKey);
  if (galleryKey) roleKeys.add(galleryKey);

  const fields = keys.filter((key) => !roleKeys.has(key)).map((key) => fieldFor(records, key));

  return { idKey, titleKey, contentKey, termKey, galleryKey, fields, confidence: { id: idConf, title: titleConf, terms: termsConf } };
}
