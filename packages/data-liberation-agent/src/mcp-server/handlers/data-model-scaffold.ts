import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, normalize, isAbsolute, relative, resolve } from 'node:path';
import * as cheerio from 'cheerio';
import type { Handler } from '../handler-types.js';
import { scaffoldDataModel } from '../../lib/replicate/local-data/scaffold-model.js';
import { parseProgram } from '../../lib/replicate/local-data/discover-js-data.js';

const MAX_JS_BYTES = 256 * 1024;

function readFiles(dir: string, exts: string[]): Array<{ name: string; text: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ name: string; text: string }> = [];
  for (const name of readdirSync(dir)) {
    if (!exts.includes(extname(name).toLowerCase())) continue;
    try {
      out.push({ name, text: readFileSync(join(dir, name), 'utf8') });
    } catch {
      // Skip unreadable local files; discovery should be best-effort per file.
    }
  }
  return out;
}

function extractInlineScripts(htmlFiles: Array<{ name: string; text: string }>): string[] {
  const scripts: string[] = [];
  for (const file of htmlFiles) {
    try {
      const $ = cheerio.load(file.text);
      $('script').each((_, element) => {
        if ($(element).attr('src') !== undefined) return;
        const text = $(element).text();
        if (text.trim()) scripts.push(text);
      });
    } catch {
      // Inline extraction is best-effort; malformed HTML should not abort scaffolding.
    }
  }
  return scripts;
}

/** Resolve a card href to a local page's HTML within `dir`. Guards path escape + unreadable files. */
function makeResolvePage(dir: string): (href: string) => string | null {
  return (href: string): string | null => {
    if (!href || /^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) return null;
    const clean = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!clean || isAbsolute(clean)) return null;
    const normalizedDir = normalize(resolve(dir));
    const resolved = normalize(join(normalizedDir, clean));
    if (!resolved.startsWith(normalizedDir)) return null;
    const insideDir = relative(normalizedDir, resolved);
    if (insideDir.startsWith('..') || isAbsolute(insideDir)) return null;
    if (!/\.html?$/i.test(resolved)) return null;
    try {
      return existsSync(resolved) ? readFileSync(resolved, 'utf8') : null;
    } catch {
      return null;
    }
  };
}

export const dataModelScaffoldHandler: Handler = async (args, ctx) => {
  const dir = args.dir as string | undefined;
  const outputDir = (args.outputDir as string | undefined) ?? dir;
  if (!dir) return ctx.errorResult('dir is required');
  if (!outputDir) return ctx.errorResult('outputDir is required');
  const start = Date.now();
  try {
    const htmlFiles = readFiles(dir, ['.html', '.htm']);
    const html = htmlFiles.map((file) => file.text).join('\n');
    const jsFiles = [...readFiles(join(dir, 'assets'), ['.js']), ...readFiles(dir, ['.js'])];
    const inlineJs = extractInlineScripts(htmlFiles);
    const skippedFiles: string[] = [];
    const goodJs: string[] = [];
    for (const file of jsFiles) {
      if (file.text.length > MAX_JS_BYTES || parseProgram(file.text) === null) {
        skippedFiles.push(file.name);
        continue;
      }
      goodJs.push(file.text);
    }

    const result = scaffoldDataModel({
      html,
      htmlFiles,
      js: [...goodJs, ...inlineJs].join('\n'),
      skippedFiles,
      resolvePage: makeResolvePage(dir),
    });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'data-model.draft.json'), JSON.stringify(result.model, null, 2), 'utf8');
    console.error(`[data-model] ${JSON.stringify({
      tool: 'scaffold',
      dir,
      ok: true,
      source: result.discovered.source,
      items: result.model.items.length,
      todos: result.skillTodos.length,
      arrays: result.discovered.arrays,
      skipped: skippedFiles,
      durationMs: Date.now() - start,
    })}`);
    return ctx.textResult(result);
  } catch (error) {
    console.error(`[data-model] ${JSON.stringify({
      tool: 'scaffold',
      dir,
      ok: false,
      durationMs: Date.now() - start,
    })}`);
    return ctx.errorResult((error as Error).message);
  }
};
