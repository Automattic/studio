import { describe, it, expect } from 'vitest';
import { inferFields } from './infer-fields.js';

const RECORDS = [
  {
    id: 'a-1',
    title: 'Alpha',
    story: 'A long descriptive paragraph about Alpha that exceeds the content threshold for sure.',
    category: 'glass',
    price: 120,
    email: 'a@x.com',
    images: [{ caption: 'front' }],
  },
  {
    id: 'b-2',
    title: 'Beta',
    story: 'Another long descriptive paragraph about Beta well beyond the content threshold here.',
    category: 'glass',
    price: 80,
    email: 'b@x.com',
    images: [{ caption: 'side' }],
  },
  {
    id: 'c-3',
    title: 'Gamma',
    story: 'Yet another sufficiently long description for Gamma so the heuristic sees body text.',
    category: 'wood',
    price: 60,
    email: 'c@x.com',
    images: [{ caption: 'top' }],
  },
];

describe('inferFields', () => {
  it('assigns roles by name + shape, routes the rest to meta, high-confidence id', () => {
    const r = inferFields(RECORDS);
    expect(r.idKey).toBe('id');
    expect(r.confidence.id).toBe('high');
    expect(r.titleKey).toBe('title');
    expect(r.contentKey).toBe('story');
    expect(r.termKey).toBe('category');
    expect(r.galleryKey).toBe('images');
    expect(r.fields).toContainEqual({ key: 'price', type: 'integer' });
    expect(r.fields).toContainEqual({ key: 'email', type: 'string', format: 'email' });
    expect(r.fields.find((f) => f.key === 'category')).toBeUndefined();
  });

  it('flags id LOW when no id-like key and values are non-unique or non-scalar (never drops)', () => {
    const recs = [{ ref: { x: 1 }, blob: 'zzz', n: 1 }, { ref: { x: 2 }, blob: 'zzz', n: 2 }];
    const r = inferFields(recs);
    expect(r.confidence.id).toBe('low');
    expect(r.fields.map((f) => f.key).sort()).toEqual(['blob', 'n', 'ref']);
  });
});
