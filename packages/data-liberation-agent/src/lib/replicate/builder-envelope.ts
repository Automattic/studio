// src/lib/replicate/builder-envelope.ts
// Validates the structured JSON envelope a builder subagent returns. A
// malformed/partial return must be a LOUD failure (→ retry/sequential), never a
// silent corruption of the assembled theme.
//
// Hardening (Neptune technique #4):
// - recoverJsonObject: models occasionally wrap the envelope in prose; recover
//   by extracting every top-level balanced {…} substring (string/escape-aware)
//   and taking the LARGEST that parses — the real envelope dwarfs any echoed
//   JSON snippet in surrounding prose.
// - Unknown top-level keys are rejected (catches schema drift / dead writes).
// - blockStyleVariations: optional; every declared variation's is-style-<slug>
//   class MUST appear in at least one pattern's markup (a declared-but-unused
//   variation is a dead write), and slugs MUST be lib- prefixed.
// See docs/superpowers/specs/2026-06-10-neptune-best-parts-design.md (section B).
export interface BuilderPattern { slug: string; php: string; }
export interface BuilderBlockStyleVariation {
  slug: string; title: string; blockTypes: string[]; styles: Record<string, unknown>;
}
export interface BuilderEnvelope {
  patterns: BuilderPattern[];
  sitewideFlags: string[];
  notes: string[];
  blockStyleVariations: BuilderBlockStyleVariation[];
}
export interface EnvelopeParseResult { ok: boolean; envelope?: BuilderEnvelope; errors: string[]; }

const ALLOWED_KEYS = new Set(['patterns', 'sitewideFlags', 'notes', 'blockStyleVariations']);
const VARIATION_SLUG_RE = /^lib-[a-z0-9][a-z0-9-]*$/;

export function recoverJsonObject(input: string): string | undefined {
  // The rescan-after-unclosed-brace loop is O(n²) worst case (e.g. '{{{{…').
  // The length cap bounds n but not n² (500k of braces is still ~1.25e11
  // steps), so a total-work budget bounds the scan absolutely: a real
  // prose-wrapped envelope closes its braces and never gets near it; a
  // pathological all-brace input bails with whatever was recovered so far.
  if (input.length > 500_000) input = input.slice(0, 500_000);
  const WORK_BUDGET = 10_000_000;
  let work = 0;
  let best: string | undefined;
  let i = 0;
  while (i < input.length) {
    if (work > WORK_BUDGET) return best;
    if (input[i] !== '{') { i++; work++; continue; }
    let depth = 0, inString = false, escape = false;
    let j = i;
    for (; j < input.length; j++) {
      work++;
      const c = input[j]!;
      if (escape) { escape = false; continue; }
      if (inString) {
        if (c === '\\') escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const candidate = input.slice(i, j + 1);
          try {
            JSON.parse(candidate);
            if (!best || candidate.length > best.length) best = candidate;
          } catch { /* not valid JSON — keep scanning */ }
          i = j + 1; break;
        }
      }
    }
    // Inner loop only exhausts (j === input.length) when the brace never
    // closed — a closed candidate breaks with j < input.length and i already
    // advanced past it.
    if (j >= input.length) i++;
  }
  return best;
}

export interface ParseBuilderEnvelopeOpts {
  /** Slugs already registered in the inventory. A `blockStyleVariations` entry
   *  whose slug matches one of these is a redeclare — the caller should reuse
   *  `is-style-<slug>` instead of registering a duplicate. */
  existingVariationSlugs?: string[];
}

export function parseBuilderEnvelopeText(raw: string, opts?: ParseBuilderEnvelopeOpts): EnvelopeParseResult {
  try {
    return parseBuilderEnvelope(JSON.parse(raw), opts);
  } catch {
    const recovered = recoverJsonObject(raw);
    if (recovered !== undefined) return parseBuilderEnvelope(JSON.parse(recovered), opts);
    return { ok: false, errors: [`envelope was not valid JSON (no balanced object recovered). First 500 chars: ${raw.slice(0, 500)}`] };
  }
}

export function parseBuilderEnvelope(raw: unknown, opts?: ParseBuilderEnvelopeOpts): EnvelopeParseResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['envelope must be a JSON object'] };
  }
  const obj = raw as Record<string, unknown>;
  const unknown = Object.keys(obj).filter(k => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) errors.push(`envelope has unknown top-level key(s): ${unknown.join(', ')} (allowed: ${[...ALLOWED_KEYS].join(', ')})`);
  if (!Array.isArray(obj.patterns)) {
    errors.push('envelope.patterns must be an array');
  } else {
    obj.patterns.forEach((p, i) => {
      const pat = p as Record<string, unknown>;
      if (typeof pat?.slug !== 'string') errors.push(`patterns[${i}].slug must be a string`);
      if (typeof pat?.php !== 'string') errors.push(`patterns[${i}].php must be a string`);
    });
  }
  if (obj.sitewideFlags !== undefined && !Array.isArray(obj.sitewideFlags)) {
    errors.push('envelope.sitewideFlags must be an array when present');
  }
  if (obj.notes !== undefined && !Array.isArray(obj.notes)) {
    errors.push('envelope.notes must be an array when present');
  }
  const variations: BuilderBlockStyleVariation[] = [];
  if (obj.blockStyleVariations !== undefined) {
    if (!Array.isArray(obj.blockStyleVariations)) {
      errors.push('envelope.blockStyleVariations must be an array when present');
    } else {
      const allPhp = Array.isArray(obj.patterns)
        ? obj.patterns.map(p => String((p as Record<string, unknown>)?.php ?? '')).join('')
        : '';
      obj.blockStyleVariations.forEach((v, i) => {
        const ent = v as Record<string, unknown>;
        const slug = ent?.slug;
        if (typeof slug !== 'string' || !VARIATION_SLUG_RE.test(slug)) {
          errors.push(`blockStyleVariations[${i}].slug must be kebab-case starting with "lib-"`);
          return;
        }
        const priorErrorCount = errors.length;
        // Inventory-aware redeclare guard: if the caller passes existingVariationSlugs
        // and this slug is already registered, it's a redeclare — the builder should
        // reference is-style-<slug> in pattern markup instead of redefining it.
        if (opts?.existingVariationSlugs?.includes(slug)) {
          errors.push(`blockStyleVariations[${i}] "${slug}" redeclares an existing variation — reuse is-style-${slug} instead`);
        }
        if (typeof ent?.title !== 'string' || ent.title === '') errors.push(`blockStyleVariations[${i}].title must be a non-empty string`);
        if (!Array.isArray(ent?.blockTypes) || ent.blockTypes.length === 0) errors.push(`blockStyleVariations[${i}].blockTypes must be a non-empty array`);
        if (typeof ent?.styles !== 'object' || ent.styles === null || Array.isArray(ent.styles)) errors.push(`blockStyleVariations[${i}].styles must be an object`);
        if (!allPhp.includes(`is-style-${slug}`)) {
          errors.push(`blockStyleVariations[${i}] "${slug}" is declared but is-style-${slug} appears in no pattern markup — dead write`);
        }
        if (errors.length === priorErrorCount) variations.push(ent as unknown as BuilderBlockStyleVariation);
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    envelope: {
      patterns: (obj.patterns as BuilderPattern[]),
      sitewideFlags: (obj.sitewideFlags as string[]) ?? [],
      notes: (obj.notes as string[]) ?? [],
      blockStyleVariations: variations,
    },
  };
}
