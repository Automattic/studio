// src/lib/screenshot/freeze.ts
//
// freezePage
// ==========
// Produces a self-contained, JS-stripped HTML snapshot of a page for the
// pixel-parity ceiling spike (eng-review decisions 1B + 2A + 7A).
//
//   Playwright page ──▶ [single-file-cli bundle injected] singlefile.getPageData(removeScripts)
//                  └──▶ (fallback) inline same-origin <style>+stylesheets
//          ──▶ sanitizeFrozenHtml (reuse html-sanitize: strip JS, keep CSS)
//          ──▶ self-contained HTML string  ──▶ caller wraps as core/html
//
// single-file-cli bundle API (confirmed v2.0.83):
//   Package:   single-file-cli
//   Bundle:    node_modules/single-file-cli/lib/single-file-bundle.js
//   Export:    `script` (string) — IIFE that sets `var singlefile` on window
//   Injection: page.addScriptTag({ content: script }) — NOT a file path
//   Global:    window.singlefile (accessible as globalThis.singlefile inside page.evaluate)
//   Method:    window.singlefile.getPageData(options) → Promise<{ content: string, ... }>
//   Reference: single-file-cli/lib/single-file-script.js line 141:
//              window.singlefile.getPageData(options).then(data => {...})
//
// Note: single-file-core (the separate npm package) is raw ESM source used
// by the extension build pipeline — it has no pre-bundled injectable file and
// exposes no browser global. Use single-file-cli/lib/single-file-bundle.js for
// Playwright injection.
//
import type { Page } from 'playwright';
import { sanitizeSourceHtml } from '../streaming/html-sanitize.js';

// A real page's sanitized HTML+CSS is many KB. Anything below this is almost
// certainly a blank/shell capture (page didn't render) — fail loudly rather
// than report a falsely-low parity ceiling.
const MIN_FREEZE_BYTES = 2048;

/** Reuse the project's sanitizer: strips script/iframe/object/embed/on*=/javascript:,
 *  preserves <style> and inline style= (verified). */
export function sanitizeFrozenHtml(html: string): string {
  return sanitizeSourceHtml(html);
}

export interface FreezeResult { html: string; bytes: number; via: 'single-file-cli' | 'fallback'; }

/**
 * Freeze the currently-loaded page. Tries single-file-cli bundle injection first
 * (decision 7A); falls back to a same-origin stylesheet-inliner if the global
 * is unavailable. Output is always run through sanitizeFrozenHtml.
 *
 * @param page - Playwright Page with the target URL already loaded.
 * @param singleFileBundleScript - Optional pre-loaded IIFE string from
 *   `import('single-file-cli/lib/single-file-bundle.js').then(m => m.script)`.
 *   When omitted, the function skips directly to the fallback path.
 */
export async function freezePage(page: Page, singleFileBundleScript?: string): Promise<FreezeResult> {
  let raw: string | null = null;
  let via: FreezeResult['via'] = 'single-file-cli';

  if (singleFileBundleScript) {
    let injected = false;
    try {
      await page.addScriptTag({ content: singleFileBundleScript });
      injected = true;
    } catch (e) {
      console.error(`[freeze] single-file bundle injection failed: ${(e as Error).message}`);
    }
    if (injected) {
      try {
        raw = await page.evaluate(async () => {
          const sf = (globalThis as unknown as { singlefile?: { getPageData: (o: unknown) => Promise<{ content: string }> } }).singlefile;
          if (!sf) return null;
          const data = await sf.getPageData({ removeScripts: true, removeHiddenElements: false, compressHTML: false });
          return data.content;
        });
      } catch (e) {
        console.error(`[freeze] single-file getPageData failed: ${(e as Error).message}`);
        raw = null;
      }
    }
  }

  // If single-file returned non-null but suspiciously tiny content, treat as failure
  // and fall through to the inliner fallback.
  if (raw != null && raw.length < MIN_FREEZE_BYTES) {
    console.error(`[freeze] single-file returned only ${raw.length} bytes; falling back to inliner`);
    raw = null;
  }

  if (raw == null) {
    // Fallback: inline same-origin stylesheets as <style> tags, keep <link> for fonts,
    // serialize outerHTML. Cross-origin sheets (CSSOM throws) are left as their <link>.
    via = 'fallback';
    raw = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        const owner = sheet.ownerNode as Element | null;
        if (owner && owner.tagName === 'STYLE') continue; // already in outerHTML
        let cssText = '';
        try { cssText = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n'); }
        catch { continue; } // cross-origin: leave its <link> in place
        if (!cssText) continue;
        const style = document.createElement('style');
        style.textContent = cssText;
        document.head.appendChild(style);
        if (owner && owner.tagName === 'LINK') owner.remove();
      }
      return '<!DOCTYPE html>' + document.documentElement.outerHTML;
    });
  }

  const html = sanitizeFrozenHtml(raw);
  const bytes = Buffer.byteLength(html, 'utf8');

  if (bytes < MIN_FREEZE_BYTES) {
    throw new Error(`[freeze] output is suspiciously small (${bytes} bytes, via ${via}) — the page likely did not render; aborting to avoid a false parity ceiling`);
  }

  return { html, bytes, via };
}
