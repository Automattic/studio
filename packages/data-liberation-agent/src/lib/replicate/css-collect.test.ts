import { describe, it, expect } from 'vitest';
import { collectCss } from './css-collect.js';

describe('collectCss', () => {
  it('concatenates inline style text and fetched external sheets, resolving relative hrefs', async () => {
    const html = '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="https://cdn/b.css">';
    const fetched: string[] = [];
    const out = await collectCss({
      html,
      inlineStyleText: '.inline{color:red}',
      baseUrl: 'https://src.example/page',
      fetcher: async (url) => { fetched.push(url); return `/* ${url} */`; },
    });
    expect(fetched).toContain('https://src.example/a.css'); // relative resolved against baseUrl
    expect(fetched).toContain('https://cdn/b.css');
    expect(out).toContain('.inline{color:red}');
    expect(out).toContain('/* https://cdn/b.css */');
  });

  it('skips a failing sheet without aborting the rest', async () => {
    const html = '<link rel="stylesheet" href="https://cdn/ok.css"><link rel="stylesheet" href="https://cdn/bad.css">';
    // The bad fetch carries a distinct sentinel inside the thrown error; if the
    // failed sheet leaked into the output it would surface here.
    const out = await collectCss({
      html, inlineStyleText: '', baseUrl: 'https://src.example/',
      fetcher: async (url) => {
        if (url.includes('bad')) throw new Error('BAD_SHEET_BODY');
        return 'OK{}';
      },
    });
    expect(out).toContain('OK{}');
    expect(out).not.toContain('BAD_SHEET_BODY');
  });

  it('invokes onError with the failing URL and reason', async () => {
    const html = '<link rel="stylesheet" href="https://cdn/ok.css"><link rel="stylesheet" href="https://cdn/bad.css">';
    const errors: Array<{ url: string; err: unknown }> = [];
    await collectCss({
      html, inlineStyleText: '', baseUrl: 'https://src.example/',
      fetcher: async (url) => { if (url.includes('bad')) throw new Error('boom'); return 'OK{}'; },
      onError: (url, err) => errors.push({ url, err }),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].url).toBe('https://cdn/bad.css');
    expect((errors[0].err as Error).message).toBe('boom');
  });

  it('deduplicates identical hrefs', async () => {
    const html = '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/a.css">';
    const fetched: string[] = [];
    await collectCss({
      html, inlineStyleText: '', baseUrl: 'https://src.example/',
      fetcher: async (url) => { fetched.push(url); return 'A{}'; },
    });
    expect(fetched.filter(u => u === 'https://src.example/a.css')).toHaveLength(1);
  });
});
