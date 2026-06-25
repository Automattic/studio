import * as cheerio from 'cheerio';
import type { SectionSpec } from './section-extract.js';

export interface RegionSplit {
  headerHtml: string;
  mainHtml: string;
  footerHtml: string;
}

/**
 * Split a captured page body into three regions:
 *   header — the first top-level <header> or [role=banner]
 *   footer — the last top-level <footer> or [role=contentinfo]
 *   main   — everything remaining between them
 *
 * "Top-level" is enforced by `root.children()`, so a <header> nested deep
 * inside <main> is left in mainHtml rather than extracted as the page header.
 *
 * The `_specs` parameter is accepted for a future override path but is
 * intentionally unused in v1.
 */
export function splitRegions(bodyHtml: string, _specs: SectionSpec[]): RegionSplit {
  const $ = cheerio.load(bodyHtml, null, false);
  const root = $.root();

  const header = root.children('header, [role="banner"]').first();
  const footer = root.children('footer, [role="contentinfo"]').last();

  const headerHtml = header.length ? $.html(header) : '';
  const footerHtml = footer.length ? $.html(footer) : '';

  if (header.length) header.remove();
  if (footer.length) footer.remove();

  const mainHtml = $.html(root).trim();
  return { headerHtml, mainHtml, footerHtml };
}
