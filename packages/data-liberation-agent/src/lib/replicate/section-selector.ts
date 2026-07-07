// src/lib/replicate/section-selector.ts
//
// Compact, readable, reasonably-stable CSS selector for one source element.
// Pure — no DOM, no cheerio. The browser walk (extractFull) emits the raw
// SelectorParts; this builds the string Node-side so the logic is unit-testable
// and shared. Format: tag(#id)?(.class){0,3}(:nth-of-type(n))?.

export interface SelectorParts {
  /** Lowercased tag name. */
  tag: string;
  /** Element id, or null. */
  id: string | null;
  /** Raw class list in document order. */
  classes: string[];
  /** 1-based index among same-tag siblings (for :nth-of-type). */
  nthOfType: number;
}

/** True for builder-generated hash-y classes we should not anchor on. */
function isHashy(cls: string): boolean {
  return cls.length >= 16 || /[0-9a-f]{6,}/i.test(cls);
}

export function buildSelector(parts: SelectorParts): string {
  let sel = parts.tag;
  if (parts.id) sel += `#${parts.id}`;
  const kept = parts.classes.filter((c) => c && !isHashy(c)).slice(0, 3);
  for (const c of kept) sel += `.${c}`;
  // Disambiguate by position ONLY when neither id nor a kept class is present.
  if (!parts.id && kept.length === 0) sel += `:nth-of-type(${parts.nthOfType})`;
  return sel;
}
