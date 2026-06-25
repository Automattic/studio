import { describe, it, expect } from 'vitest';
import { guessEmbedProvider, buildEmbedBlock } from './embed-block.js';

describe('guessEmbedProvider', () => {
  it('maps known video providers to their slug', () => {
    expect(guessEmbedProvider('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(guessEmbedProvider('https://youtu.be/abc')).toBe('youtube');
    expect(guessEmbedProvider('https://player.vimeo.com/video/123')).toBe('vimeo');
    expect(guessEmbedProvider('https://www.dailymotion.com/video/x1')).toBe('dailymotion');
  });

  it('maps known rich providers to their slug', () => {
    expect(guessEmbedProvider('https://twitter.com/a/status/1')).toBe('twitter');
    expect(guessEmbedProvider('https://www.instagram.com/p/abc/')).toBe('instagram');
    expect(guessEmbedProvider('https://www.facebook.com/x/posts/1')).toBe('facebook');
    expect(guessEmbedProvider('https://www.tiktok.com/@a/video/1')).toBe('tiktok');
    expect(guessEmbedProvider('https://soundcloud.com/a/b')).toBe('soundcloud');
    expect(guessEmbedProvider('https://open.spotify.com/track/1')).toBe('spotify');
  });

  it('treats x.com as twitter', () => {
    expect(guessEmbedProvider('https://x.com/a/status/1')).toBe('twitter');
  });

  it('returns null for an unknown provider', () => {
    expect(guessEmbedProvider('https://maps.example.com/embed?pb=1')).toBeNull();
  });
});

describe('buildEmbedBlock', () => {
  it('emits a video embed with 16:9 aspect classes for youtube', () => {
    const out = buildEmbedBlock('https://www.youtube.com/embed/abc');
    expect(out).toContain('<!-- wp:embed');
    expect(out).toContain('"type":"video"');
    expect(out).toContain('"providerNameSlug":"youtube"');
    expect(out).toContain('"responsive":true');
    expect(out).toContain('is-provider-youtube');
    expect(out).toContain('wp-block-embed-youtube');
    expect(out).toContain('wp-embed-aspect-16-9');
    expect(out).toContain('wp-has-aspect-ratio');
    expect(out).toContain('https://www.youtube.com/embed/abc');
    expect(out).toContain('<!-- /wp:embed -->');
  });

  it('emits a rich embed without aspect-ratio classes for twitter', () => {
    const out = buildEmbedBlock('https://twitter.com/a/status/1');
    expect(out).toContain('"type":"rich"');
    expect(out).toContain('"providerNameSlug":"twitter"');
    expect(out).not.toContain('wp-embed-aspect');
    expect(out).not.toContain('wp-has-aspect-ratio');
  });

  it('emits a lossless generic embed for an unknown provider', () => {
    const url = 'https://widgets.example.com/embed/xyz';
    const out = buildEmbedBlock(url);
    expect(out).toContain('<!-- wp:embed');
    expect(out).toContain(`"url":"${url}"`);
    expect(out).toContain('"responsive":true');
    expect(out).not.toContain('"type"');
    expect(out).not.toContain('providerNameSlug');
    expect(out).not.toContain('wp-embed-aspect');
    expect(out).toContain(url);
  });
});
