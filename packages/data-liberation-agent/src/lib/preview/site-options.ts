import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readWxr } from '../wxr/index.js';

export interface SourceSiteMeta {
  title?: string;
  tagline?: string;
  language?: string;
}

function normalizeSiteOptionValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function wpOptionUpdatesForSiteMeta(meta: SourceSiteMeta | null | undefined): Array<[string, string]> {
  if (!meta) return [];
  const updates: Array<[string, string]> = [];
  const title = normalizeSiteOptionValue(meta.title);
  if (title) {
    updates.push(['blogname', title]);
  }
  if (typeof meta.tagline === 'string') {
    updates.push(['blogdescription', normalizeSiteOptionValue(meta.tagline) ?? '']);
  }
  return updates;
}

export function readSiteMetaFromWxr(outputDir: string): SourceSiteMeta | null {
  const wxrPath = join(outputDir, 'output.wxr');
  if (!existsSync(wxrPath)) return null;
  try {
    const wxr = readWxr(wxrPath);
    return {
      title: wxr.site.title,
      tagline: wxr.site.description,
      language: wxr.site.language,
    };
  } catch {
    return null;
  }
}

export function wpCliQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
