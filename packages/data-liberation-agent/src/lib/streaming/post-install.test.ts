import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { installPost } from './post-install.js';
import type { WxrItem, PageItem, PostItem, MediaItem } from '../wxr/index.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function makePage(overrides: Partial<PageItem> = {}): PageItem {
  return {
    id: 1,
    type: 'page',
    title: 'About',
    slug: 'about',
    content: '<p>About us</p>',
    excerpt: '',
    date: '2026-04-29T12:00:00.000Z',
    parent: 0,
    menuOrder: 0,
    author: 'admin',
    seoTitle: '',
    seoDescription: '',
    sourceUrl: 'https://example.com/about',
    ...overrides,
  };
}

describe('installPost', () => {
  it('returns null for non-post items (attachment, nav menu, etc.)', async () => {
    const attachment: MediaItem = {
      id: 1,
      type: 'attachment',
      title: 'image.png',
      slug: 'image-png',
      url: 'https://example.com/image.png',
      altText: '',
      caption: '',
    };
    const result = await installPost({
      item: attachment,
      outputDir: FIXTURE_TMP,
      studioSitePath: '/tmp/site',
    });
    expect(result).toBeNull();
  });

  it('errors when sourceUrl meta is missing', async () => {
    const page = makePage({ sourceUrl: '' });
    const result = await installPost({
      item: page,
      outputDir: FIXTURE_TMP,
      studioSitePath: '/tmp/site',
    });
    expect(result?.action).toBe('error');
    expect(result?.error).toMatch(/sourceUrl/);
  });
});

// Regression guard for the dla/editable-html "can't edit text" defect: the
// install scripts MUST wp_slash() the post array before wp_insert_post /
// wp_update_post, because those functions wp_unslash() internally. Without it,
// backslashes in block-attribute JSON (e.g. the `frame` attr's \n / -
// escapes) are stripped, invalidating the block in the editor. The bug is
// invisible for plain content (no backslashes), so only a static guard catches
// a silent removal.
describe('install scripts slash post_content before insert/update', () => {
  const scriptsDir = join(process.cwd(), 'src', 'lib', 'preview', 'scripts');

  it('install-post.php wraps wp_insert_post and wp_update_post in wp_slash', () => {
    const php = readFileSync(join(scriptsDir, 'install-post.php'), 'utf8');
    expect(php).toMatch(/wp_insert_post\(\s*wp_slash\(/);
    expect(php).toMatch(/wp_update_post\(\s*wp_slash\(/);
    // and never an un-slashed call to either (the regression we are guarding)
    expect(php).not.toMatch(/wp_insert_post\(\s*\$postarr\b/);
    expect(php).not.toMatch(/wp_update_post\(\s*\$update\b/);
  });

  it('install-data.php wraps wp_insert_post and wp_update_post in wp_slash', () => {
    const php = readFileSync(join(scriptsDir, 'install-data.php'), 'utf8');
    expect(php).toMatch(/wp_insert_post\(\s*wp_slash\(/);
    expect(php).toMatch(/wp_update_post\(\s*wp_slash\(/);
  });

  it('install-data.php wp_slashes item-derived update_post_meta values', () => {
    // update_post_meta() also wp_unslash()es internally, so backslash-bearing
    // meta values (e.g. JSON/escaped text in custom meta) must be slashed too.
    const php = readFileSync(join(scriptsDir, 'install-data.php'), 'utf8');
    expect(php).toMatch(/update_post_meta\(\s*\$post_id,\s*\$key,\s*wp_slash\(/);
    expect(php).toMatch(/update_post_meta\([^)]*'_dla_item_id',\s*wp_slash\(/);
    expect(php).toMatch(/update_post_meta\([^)]*'_dla_gallery',\s*wp_slash\(/);
    // the regression we are guarding: never the un-slashed custom-meta write
    expect(php).not.toMatch(/update_post_meta\(\s*\$post_id,\s*\$key,\s*\$meta\[/);
  });
});
