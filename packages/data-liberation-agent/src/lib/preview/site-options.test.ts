import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readSiteMetaFromWxr,
  wpCliQuote,
  wpOptionUpdatesForSiteMeta,
} from './site-options.js';

describe('site options helpers', () => {
  it('builds WordPress option updates from source site metadata', () => {
    expect(wpOptionUpdatesForSiteMeta({
      title: 'Swift Lumber',
      tagline: 'Quality building materials',
    })).toEqual([
      ['blogname', 'Swift Lumber'],
      ['blogdescription', 'Quality building materials'],
    ]);
  });

  it('keeps an empty source tagline so WordPress default tagline is cleared', () => {
    expect(wpOptionUpdatesForSiteMeta({
      title: 'Swift Lumber',
      tagline: '',
    })).toEqual([
      ['blogname', 'Swift Lumber'],
      ['blogdescription', ''],
    ]);
  });

  it('reads source site metadata from output.wxr', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-options-'));
    try {
      writeFileSync(
        join(dir, 'output.wxr'),
        `<?xml version="1.0"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Swift Lumber</title>
    <link>https://www.swiftlumber.com</link>
    <description>Quality building materials</description>
    <language>en-US</language>
    <wp:base_blog_url>https://www.swiftlumber.com</wp:base_blog_url>
  </channel>
</rss>`,
      );

      expect(readSiteMetaFromWxr(dir)).toEqual({
        title: 'Swift Lumber',
        tagline: 'Quality building materials',
        language: 'en-US',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('quotes wp-cli command values safely', () => {
    expect(wpCliQuote("Matt's Site")).toBe("'Matt'\\''s Site'");
  });
});
