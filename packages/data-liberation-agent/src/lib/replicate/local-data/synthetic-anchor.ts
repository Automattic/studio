// src/lib/replicate/local-data/synthetic-anchor.ts
//
// Shared between the scaffold (which sets a static-card mount's `selector` to
// `#<id>`) and the ingest neutralizer (which stamps `<id>` onto the container)
// so the two agree on the anchor without coordinating. Deterministic so re-runs
// are idempotent; disambiguator (grid index / page slug) keeps two grids from
// aliasing to one id.

/** Deterministic, collision-resistant anchor id for a static-card container.
 *  Hashes the container selector + a disambiguator via FNV-1a (no crypto dep). */
export function syntheticCardAnchor(selector: string, disambiguator: string): string {
  const input = `${selector}::${disambiguator}`;
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return `dla-cards-${(hash >>> 0).toString(36)}`;
}
