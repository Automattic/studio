// tools/lib/fix-markup.mjs — canonicalize block markup through the registry.
//
// Ported from telex's block-fixer core (scripts/block-fixer/lib/blockFixer.js):
// parse() the markup, recreate every named block from its parsed attributes
// with createBlock(), and serialize() the result. The regenerated markup is
// byte-identical to what each block's save() produces, which eliminates the
// editor's block validation errors caused by drifted hand-written or
// AI-generated markup. Freeform/unnamed blocks pass through untouched.
//
// telex's nested-<p> regex pre-fix is NOT ported: it targets malformed raw
// AI HTML; everything this pipeline handles is parseable block markup.

import { loadWordPressBlocks } from './wp-serialize.mjs';

// parse() injects per-type attribute values that createBlock() does not
// (declared defaults rebuilt as fresh objects, and parse-time filters like
// core's default block bindings on post-date). The editor performs the same
// injection on ANY markup, so these are parse artifacts — bake them into the
// regenerated comment and idempotency breaks. Compute each type's injected
// set once by round-tripping a minimal block.
const parseInjectedCache = new Map();
function parseInjectedAttrs(wpBlocks, name) {
    if (!parseInjectedCache.has(name)) {
        const injected = {};
        try {
            const minimal = wpBlocks.createBlock(name, {});
            const [reparsed] = wpBlocks.parse(wpBlocks.serialize([minimal]));
            for (const [key, value] of Object.entries(reparsed?.attributes || {})) {
                injected[key] = JSON.stringify(value);
            }
        } catch { /* leave empty: strip nothing for this type */ }
        parseInjectedCache.set(name, injected);
    }
    return parseInjectedCache.get(name);
}

function recreateBlock(wpBlocks, block) {
    const innerBlocks = (block.innerBlocks || []).map((inner) => recreateBlock(wpBlocks, inner));
    if (!block.name) return block; // freeform HTML: nothing to regenerate from
    const injected = parseInjectedAttrs(wpBlocks, block.name);
    const attributes = {};
    for (const [key, value] of Object.entries(block.attributes || {})) {
        if (injected[key] !== undefined && JSON.stringify(value) === injected[key]) continue;
        attributes[key] = value;
    }
    return wpBlocks.createBlock(block.name, attributes, innerBlocks);
}

function collectIssues(blocks, issues) {
    for (const block of blocks || []) {
        if (block.isValid === false) {
            const name = block.name || 'unknown';
            const detail = (block.validationIssues || [])
                .map((issue) => (typeof issue === 'string' ? issue : Array.isArray(issue.args) && typeof issue.args[0] === 'string' ? issue.args[0] : 'block marked invalid'))
                .join('; ');
            issues.push(`${name}: ${detail || 'block marked invalid'}`);
        }
        collectIssues(block.innerBlocks, issues);
    }
}

// Callers must have registered all blocks the markup uses (core + custom)
// before calling — see ensureBlocksRegistered in wp-serialize.mjs.
export function fixBlockMarkup(markup) {
    const wpBlocks = loadWordPressBlocks();
    const parsed = wpBlocks.parse(markup);
    const issues = [];
    collectIssues(parsed, issues);
    const fixed = `${wpBlocks.serialize(parsed.map((block) => recreateBlock(wpBlocks, block))).trim()}\n`;
    return {
        markup: fixed,
        changed: fixed.trim() !== markup.trim(),
        issues,
    };
}
