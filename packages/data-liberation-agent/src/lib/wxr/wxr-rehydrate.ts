import { existsSync } from 'node:fs';
import { readWxr } from './wxr-reader.js';
import type { WxrBuilder } from './wxr-builder.js';

/**
 * Rehydrate a fresh WxrBuilder from an existing WXR file so a subsequent
 * serialize() preserves prior items instead of overwriting them with only the
 * items extracted in the current run.
 *
 * Used by the resume path of liberate_extract and by every liberate_extract_one
 * call (which appends a single URL to an existing extraction). Without this, both
 * handlers serialize a builder holding only the current run's items, silently
 * truncating the WXR — see DISCOVERIES.md (2026-04-30).
 *
 * nav_menu_items are dropped because the extraction loop regenerates them
 * deterministically from the current inventory's navigation each run; keeping the
 * prior ones would duplicate them. _nextId is reseeded past the largest existing
 * id so newly added items never collide with rehydrated ones.
 *
 * A missing prior WXR is a no-op; a corrupt/unreadable one is treated as a fresh
 * start (the builder is left untouched).
 *
 * @returns true if prior items were merged, false if there was nothing to merge.
 */
export function rehydrateBuilderFromWxr(wxr: WxrBuilder, wxrPath: string): boolean {
  if (!existsSync(wxrPath)) return false;
  try {
    const prior = readWxr(wxrPath);
    wxr.authors = prior.authors;
    wxr.categories = prior.categories;
    wxr.tags = prior.tags;
    wxr.terms = prior.terms;
    wxr.comments = prior.comments;
    wxr.redirects = prior.redirects;
    wxr.items = prior.items.filter((item) => item.type !== 'nav_menu_item');

    let maxId = 0;
    for (const item of wxr.items) maxId = Math.max(maxId, item.id);
    for (const author of wxr.authors) maxId = Math.max(maxId, author.id);
    for (const category of wxr.categories) maxId = Math.max(maxId, category.id);
    for (const tag of wxr.tags) maxId = Math.max(maxId, tag.id);
    for (const term of wxr.terms) maxId = Math.max(maxId, term.id);
    for (const comment of wxr.comments) maxId = Math.max(maxId, comment.id);
    wxr._nextId = maxId + 1;
    return true;
  } catch {
    // Corrupt prior WXR: fall through and treat this as a fresh run.
    return false;
  }
}
