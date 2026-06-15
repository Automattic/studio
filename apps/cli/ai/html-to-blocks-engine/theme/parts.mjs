// tools/theme/parts.mjs
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJson, resolvePath } from '../lib/workspace.mjs';
import { loadPageTrees } from './evidence.mjs';

const CONTENT_KEYS = new Set(['content', 'text', 'caption', 'label', 'alt', 'okText', 'noteText', 'submitText', 'brand', 'items', 'links', 'fields', 'url', 'href', 'anchor']);

function sha(value) { return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex'); }

function exactShape(block) {
    return [block.blockName, sortedEntries(block.attrs || {}), (block.innerBlocks || []).map(exactShape)];
}
function structuralShape(block) {
    const attrs = block.attrs || {};
    return [
        block.blockName,
        String(attrs.className || '').split(/\s+/).filter(Boolean).sort(),
        Object.keys(attrs).filter((k) => !CONTENT_KEYS.has(k)).sort(),
        (block.innerBlocks || []).map(structuralShape),
    ];
}
function sortedEntries(obj) {
    return Object.keys(obj).sort().map((k) => [k, obj[k] && typeof obj[k] === 'object' ? sortedEntries(obj[k]) : obj[k]]);
}
export function exactHash(block) { return sha(exactShape(block)); }
export function structuralHash(block) { return sha(structuralShape(block)); }

export function diffSubtrees(occurrences) {
    // walk all occurrence subtrees in lockstep; report paths where exact values differ
    const variance = [];
    walk(occurrences.map((o) => o.block), '');
    return variance;

    function walk(nodes, prefix) {
        const attrsList = nodes.map((n) => n.attrs || {});
        const keys = new Set(attrsList.flatMap((a) => Object.keys(a)));
        for (const key of keys) {
            const values = attrsList.map((a) => JSON.stringify(a[key]));
            if (new Set(values).size > 1) {
                variance.push({
                    path: prefix ? `${prefix}:attrs.${key}` : `attrs.${key}`,
                    values: Object.fromEntries(occurrences.map((o, i) => [o.page, attrsList[i][key]])),
                });
            }
        }
        const childCount = Math.max(...nodes.map((n) => (n.innerBlocks || []).length));
        for (let c = 0; c < childCount; c += 1) {
            walk(nodes.map((n) => (n.innerBlocks || [])[c] || { attrs: {}, innerBlocks: [] }), prefix ? `${prefix}.${c}` : String(c));
        }
    }
}

export function inferTemplateParts(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const pages = loadPageTrees(workspaceRoot);
    const byStructure = new Map();
    for (const { page, tree } of pages) {
        tree.blocks.forEach((block, index) => {
            const key = structuralHash(block);
            const entry = byStructure.get(key) || [];
            entry.push({
                page, index, block,
                first: index === 0, last: index === tree.blocks.length - 1,
                tagName: block.attrs?.tagName || null, blockName: block.blockName,
                className: block.attrs?.className || '',
                exact: exactHash(block),
            });
            byStructure.set(key, entry);
        });
    }
    const groups = [];
    const singletons = [];
    for (const [structural, occurrences] of byStructure) {
        const pagesIn = new Set(occurrences.map((o) => o.page));
        if (pagesIn.size < 2) {
            singletons.push(...occurrences.map(({ block, exact, ...rest }) => rest));
            continue;
        }
        const exactSet = new Set(occurrences.map((o) => o.exact));
        groups.push({
            structuralHash: structural,
            kind: exactSet.size === 1 ? 'exact' : 'structural',
            occurrences: occurrences.map(({ block, exact, ...rest }) => rest),
            variance: exactSet.size === 1 ? [] : diffSubtrees(occurrences),
        });
    }
    groups.sort((a, b) => b.occurrences.length - a.occurrences.length);
    const report = { generatedAt: new Date().toISOString(), pages: pages.map((p) => p.page), groups, singletons };
    if (args.write !== false) writeJson(path.join(workspaceRoot, 'reports/template-parts.json'), report);
    return report;
}
