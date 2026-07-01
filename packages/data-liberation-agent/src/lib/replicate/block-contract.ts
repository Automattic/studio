// src/lib/replicate/block-contract.ts
//
// Pre-serialization block contract (BDC survey adoption — measurement only).
// Validates EMITTED block-markup STRINGS against a checked-in snapshot of
// WordPress's registered core-block metadata: invented core blocks, invented
// attrs on real blocks, and core/group tagNames outside WP's allowlist are
// reported as WARNING-level issues. The gate's value is catching OUR emitter
// bugs before they ship; it never throws (trust-source posture).
//
// Deliberately a STRING validator (parse → attrs vs snapshot), not a
// tree-first emitter rearchitecture — same catch-rate for invented
// attrs/blocks at a fraction of the surface.
//
// Scope:
// - Only core/* blocks are validated. Allowlisted prefixes (default
//   ['dla/', 'core/html']) skip entirely — deliberate non-core (iAPI blocks)
//   and verbatim islands. Any OTHER non-core namespace (acme/widget) also
//   skips: we have no metadata for third-party blocks and inventing
//   judgments about them would be guessing (trust-source posture).
// - attrs === null (unparseable JSON) is the roundtrip oracle's failure to
//   report; here it degrades to "no attrs to check".
//
// Snapshot: ./core-block-attrs.json — block name → registered attr names +
// the core/group tagName allowlist. REGENERATE on @wordpress/block-library
// bumps (pinned in scripts/block-fixer/package.json):
//   cd scripts/block-fixer && pnpm install --frozen-lockfile && cd ../..
//   node scripts/generate-block-attrs-snapshot.mjs
import { readFileSync } from 'node:fs';
import { parse } from '@wordpress/block-serialization-default-parser';
import { walkBlocks, type ParsedBlock } from './block-tree.js';

interface BlockAttrsSnapshot {
  __generated: string;
  __wpBlockLibrary: string;
  groupTagNames: string[];
  blocks: Record<string, string[]>;
}

const SNAPSHOT = JSON.parse(
  readFileSync(new URL('./core-block-attrs.json', import.meta.url), 'utf8'),
) as BlockAttrsSnapshot;

// Set-backed lookups, built once at module load.
const ATTRS_BY_BLOCK = new Map<string, Set<string>>(
  Object.entries(SNAPSHOT.blocks).map(([name, attrs]) => [name, new Set(attrs)]),
);
const GROUP_TAGS = new Set(SNAPSHOT.groupTagNames);

export interface BlockContractIssue {
  code: 'unknown-block' | 'unknown-attr' | 'invalid-tagname';
  blockName: string;
  detail: string;
}

export interface BlockContractOpts {
  /** Entries ending '/' are namespace prefixes; others are exact block names. */
  allowlist?: string[];
}

const DEFAULT_ALLOWLIST = ['dla/', 'core/html'];

function isAllowlisted(blockName: string, allowlist: string[]): boolean {
  return allowlist.some((entry) =>
    entry.endsWith('/') ? blockName.startsWith(entry) : blockName === entry,
  );
}

function checkBlock(b: ParsedBlock, allowlist: string[], issues: BlockContractIssue[]): void {
  const name = b.blockName as string;
  if (isAllowlisted(name, allowlist)) return;
  // Only core/* validates against the snapshot; other namespaces skip
  // (no metadata for third-party blocks — see the header).
  if (!name.startsWith('core/')) return;

  const registered = ATTRS_BY_BLOCK.get(name);
  if (!registered) {
    issues.push({ code: 'unknown-block', blockName: name, detail: 'not a registered core block' });
    return;
  }
  // attrs === null (bad JSON) → roundtrip oracle reports it; nothing to check.
  const attrs = (b.attrs ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(attrs)) {
    if (!registered.has(key)) {
      issues.push({
        code: 'unknown-attr',
        blockName: name,
        detail: `attr "${key}" not in registered metadata`,
      });
    }
  }
  if (name === 'core/group') {
    const tagName = attrs.tagName;
    if (typeof tagName === 'string' && !GROUP_TAGS.has(tagName)) {
      issues.push({
        code: 'invalid-tagname',
        blockName: name,
        detail: `tagName "${tagName}" not in [${SNAPSHOT.groupTagNames.join(', ')}]`,
      });
    }
  }
}

/**
 * Pure: validate emitted markup against the registered-metadata snapshot.
 * Returns WARNING-level issues ([] = clean). Never throws.
 */
export function validateBlockContract(
  markup: string,
  opts: BlockContractOpts = {},
): BlockContractIssue[] {
  const allowlist = opts.allowlist ?? DEFAULT_ALLOWLIST;
  const issues: BlockContractIssue[] = [];
  try {
    walkBlocks(parse(markup), (b) => checkBlock(b, allowlist, issues));
  } catch {
    // A parser blowup must not fail the caller — the roundtrip oracle is the
    // structural gate; the contract check is a best-effort warning layer.
  }
  return issues;
}
