// tools/theme/validate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolvePath, readJson, readIfExists, writeJson } from '../lib/workspace.mjs';
import { ensureBlocksRegistered, loadWordPressBlocks } from '../lib/wp-serialize.mjs';
import { fixBlockMarkup } from '../lib/fix-markup.mjs';

const require = createRequire(import.meta.url);

export function validateBlockTheme(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const themeDir = path.join(workspaceRoot, 'theme', args.slug);
    const errors = [];
    const must = (cond, msg) => { if (!cond) errors.push(msg); };

    // required files + headers
    must(fs.existsSync(path.join(themeDir, 'templates/index.html')), 'templates/index.html is missing');
    const styleCss = readIfExists(path.join(themeDir, 'style.css')) || '';
    for (const field of ['Theme Name', 'Version', 'Text Domain', 'Requires at least']) {
        must(new RegExp(`${field}:\\s*\\S`).test(styleCss), `style.css header missing ${field}`);
    }
    const textDomain = (styleCss.match(/Text Domain:\s*(\S+)/) || [])[1];
    must(textDomain === args.slug, `style.css Text Domain (${textDomain}) must equal slug (${args.slug})`);

    // theme.json schema
    const themeJsonPath = path.join(themeDir, 'theme.json');
    let themeJson = null;
    if (fs.existsSync(themeJsonPath)) {
        themeJson = readJson(themeJsonPath);
        must(themeJson.version === 3, `theme.json version must be 3, got ${themeJson.version}`);
        const Ajv = require('ajv');
        const ajv = new Ajv({ strict: false, allErrors: true });
        // fileURLToPath decodes percent-encoding (URL.pathname keeps "%20" for
        // spaces, which breaks checkouts living under paths with spaces).
        const schema = readJson(fileURLToPath(new URL('./theme-json-schema.json', import.meta.url)));
        delete schema.$schema; // ajv8 rejects draft-04 marker; structure still validates
        if (!ajv.validate(schema, themeJson)) {
            for (const e of ajv.errors.slice(0, 20)) errors.push(`theme.json schema: ${e.instancePath} ${e.message}`);
        }
    } else {
        errors.push('theme.json is missing');
    }

    // parse every template and part with core + plugin blocks registered
    ensureBlocksRegistered(workspaceRoot, { blocksDir: path.join(workspaceRoot, 'theme-plugin', `${args.slug}-blocks`, 'blocks') });
    const wpBlocks = loadWordPressBlocks();
    // Grammar-level parser preserves unknown block names; wpBlocks.parse() would
    // rewrite them to core/missing and hide the violation.
    const { parse: parseGrammar } = require('@wordpress/block-serialization-default-parser');
    const known = new Set(wpBlocks.getBlockTypes().map((b) => b.name));
    for (const sub of ['templates', 'parts']) {
        const dir = path.join(themeDir, sub);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
            const rel = `${sub}/${file}`;
            const text = readIfExists(path.join(dir, file));
            const parsed = parseGrammar(text);
            walkParsed(parsed, (b) => {
                if (b.blockName === null && b.innerHTML.trim() !== '') errors.push(`${rel}: contains freeform/unparsed content`);
                if (b.blockName && !known.has(b.blockName)) errors.push(`${rel}: unknown block ${b.blockName}`);
            });
            // canonicality: parse() self-heals drifted markup through block
            // deprecations (so isValid stays true), but the file on disk
            // still fails editor validation. The reliable signal is the
            // round trip: regenerated markup must match the file.
            const roundTrip = fixBlockMarkup(text);
            const normalizeGaps = (s) => s.replace(/\n+/g, '\n').trim();
            if (normalizeGaps(roundTrip.markup) !== normalizeGaps(text)) {
                errors.push(`${rel}: invalid block markup (drifts from save() output) — run fix_block_markup`);
            }
            if (sub === 'templates' && file !== '404.html') {
                const isContentful = /wp:post-content|wp:query/.test(text);
                must(isContentful, `${rel}: template renders no content (needs post-content or a query loop)`);
            }
        }
    }

    // templateParts <-> files reconcile + refs resolve
    const partFiles = fs.existsSync(path.join(themeDir, 'parts'))
        ? fs.readdirSync(path.join(themeDir, 'parts')).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')) : [];
    for (const tp of themeJson?.templateParts || []) {
        must(partFiles.includes(tp.name), `theme.json templatePart ${tp.name} has no parts/${tp.name}.html`);
    }
    for (const file of fs.existsSync(path.join(themeDir, 'templates')) ? fs.readdirSync(path.join(themeDir, 'templates')) : []) {
        const text = readIfExists(path.join(themeDir, 'templates', file));
        // The grammar parser handles nested attr objects; a regex over the
        // comment would truncate at the first "}" inside style attrs.
        walkParsed(parseGrammar(text), (b) => {
            if (b.blockName !== 'core/template-part') return;
            const slugRef = b.attrs?.slug;
            must(slugRef !== undefined && partFiles.includes(slugRef), `templates/${file}: unresolved template-part ref ${slugRef}`);
        });
    }

    // fonts + no remote urls
    for (const fam of themeJson?.settings?.typography?.fontFamilies || []) {
        for (const face of fam.fontFace || []) {
            for (const src of face.src || []) {
                const rel = src.replace(/^file:\.\//, '');
                must(fs.existsSync(path.join(themeDir, rel)), `fontFace src missing on disk: ${src}`);
            }
        }
    }
    const themeTexts = [['style.css', styleCss], ['theme.json', JSON.stringify(themeJson)]];
    for (const [label, text] of themeTexts) {
        // www.w3.org appears as the xmlns of inline data-URI SVGs — a namespace
        // identifier, never fetched. Match on the parsed hostname (not a raw
        // substring) so an attacker-controlled host can't smuggle one of these
        // names elsewhere in the URL to dodge the remote-url check.
        const allowedHosts = new Set(['schemas.wp.org', 'gnu.org', 'www.w3.org']);
        const remotes = (text.match(/https?:\/\/[^"')\s]+/g) || []).filter((u) => {
            let hostname;
            try {
                hostname = new URL(u).hostname;
            } catch {
                return true; // unparseable url — surface it as a finding
            }
            return !allowedHosts.has(hostname);
        });
        for (const u of remotes) errors.push(`${label}: remote url ${u}`);
    }

    // content plugin payload checks
    const contentDir = path.join(workspaceRoot, 'theme-plugin', `${args.slug}-content`, 'content');
    if (fs.existsSync(contentDir)) {
        const manifest = readJson(path.join(contentDir, 'manifest.json'));
        for (const page of manifest.pages) {
            const payloadPath = path.join(contentDir, `${page.slug}.html`);
            must(fs.existsSync(payloadPath), `content payload missing for ${page.slug}`);
            const payload = readIfExists(payloadPath);
            if (payload) {
                must(!/href="[^"]*\.html/.test(payload), `content/${page.slug}.html: internal .html link survived permalink rewrite`);
                for (const u of remotePayloadAssetUrls(payload)) {
                    errors.push(`content/${page.slug}.html: remote asset url ${u} (use {{THEME_URI}})`);
                }
            }
        }
        const pluginPhp = readIfExists(path.join(workspaceRoot, 'theme-plugin', `${args.slug}-content`, `${args.slug}-content.php`)) || '';
        must(/Requires Plugins:\s*\S/.test(pluginPhp) || !fs.existsSync(path.join(workspaceRoot, 'theme-plugin', `${args.slug}-blocks`)), 'content plugin missing Requires Plugins header');
    }

    const report = { generatedAt: new Date().toISOString(), themeDir, errors, passed: errors.length === 0 };
    if (args.write !== false) writeJson(path.join(workspaceRoot, 'reports/theme-validation.json'), report);
    return report;
}

function walkParsed(blocks, fn) {
    for (const b of blocks || []) { fn(b); walkParsed(b.innerBlocks, fn); }
}

function remotePayloadAssetUrls(markup) {
    const urls = [];
    for (const match of markup.matchAll(/\b(?:src|poster)\s*=\s*["'](https?:\/\/[^"']+)/gi)) {
        urls.push(match[1]);
    }
    for (const match of markup.matchAll(/\bsrcset\s*=\s*["']([^"']+)/gi)) {
        for (const candidate of match[1].split(',')) {
            const url = candidate.trim().split(/\s+/)[0];
            if (/^https?:\/\//i.test(url)) urls.push(url);
        }
    }
    for (const match of markup.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)/gi)) {
        urls.push(match[1]);
    }
    return urls;
}
