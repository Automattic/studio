// tools/lib/workspace.mjs — shared fs/path/string helpers for all skills' tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function isPathInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolvePath(value) {
    if (!value) throw new Error('Path is required.');
    return path.resolve(String(value));
}

export function resolveWorkspacePath(workspaceRoot, value) {
    if (!value) throw new Error('Workspace-relative path is required.');
    const resolved = path.resolve(workspaceRoot, String(value));
    if (!isPathInside(workspaceRoot, resolved)) {
        throw new Error(`Path must stay inside workspaceRoot: ${value}`);
    }
    return resolved;
}

export function readIfExists(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

export function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readJsonIfExists(filePath) {
    return fs.existsSync(filePath) ? readJson(filePath) : {};
}

export function writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

export function writeJson(filePath, data) {
    writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function firstMatch(value, pattern, group = 1) {
    const match = String(value || '').match(pattern);
    return match ? match[group] : '';
}

function replaceUntilStable(input, pattern, replacement) {
    let current = input;
    let previous;
    do {
        previous = current;
        current = current.replace(pattern, replacement);
    } while (current !== previous);
    return current;
}

export function cleanText(value) {
    const withoutScripts = replaceUntilStable(
        String(value || ''),
        /<script\b[^>]*>[\s\S]*?<\/script\s*[^>]*>/gi,
        ''
    );
    const withoutStyles = replaceUntilStable(
        withoutScripts,
        /<style\b[^>]*>[\s\S]*?<\/style\s*[^>]*>/gi,
        ''
    );
    return withoutStyles
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function titleCase(value) {
    return String(value || '')
        .replace(/[-_]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function slug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function camelName(value) {
    const raw = String(value || '').trim();
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw)) {
        return raw.charAt(0).toLowerCase() + raw.slice(1);
    }
    const parts = slug(raw).split('-').filter(Boolean);
    if (!parts.length) return 'field';
    return parts[0] + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

export function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

export function relativeUrl(fromDir, targetPath) {
    const relative = path.relative(fromDir, targetPath).split(path.sep).join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
}

export function findFiles(root, basename) {
    if (!fs.existsSync(root)) return [];
    const found = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const filePath = path.join(root, entry.name);
        if (entry.isDirectory()) found.push(...findFiles(filePath, basename));
        else if (entry.name === basename) found.push(filePath);
    }
    return found;
}
