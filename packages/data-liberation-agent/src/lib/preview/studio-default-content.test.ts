import { describe, expect, it } from 'vitest';
import { deleteDefaultWpContent, WP_DEFAULT_CONTENT_SLUGS } from './studio.js';

// Uses only WordPress-default slugs (not source-site data) per project convention.
describe('deleteDefaultWpContent', () => {
  it('deletes each WP-default post that exists, by its resolved ID', async () => {
    const calls: string[][] = [];
    const runWp = async (_sitePath: string, args: string[]): Promise<string> => {
      calls.push(args);
      if (args[1] === 'list') {
        const slug = args.find((a) => a.startsWith('--name='))!.slice('--name='.length);
        // Only 'sample-page' is present (ID 2); the others are absent.
        return slug === 'sample-page' ? '2\n' : '';
      }
      return '';
    };
    const warnings = await deleteDefaultWpContent('/site', runWp);
    expect(warnings).toEqual([]);
    const deletes = calls.filter((a) => a[1] === 'delete');
    expect(deletes).toEqual([['post', 'delete', '2', '--force']]);
    // Every default slug was probed.
    expect(calls.filter((a) => a[1] === 'list')).toHaveLength(WP_DEFAULT_CONTENT_SLUGS.length);
  });

  it('issues no delete when no default content is present', async () => {
    const calls: string[][] = [];
    const runWp = async (_s: string, args: string[]): Promise<string> => {
      calls.push(args);
      return '';
    };
    await deleteDefaultWpContent('/site', runWp);
    expect(calls.some((a) => a[1] === 'delete')).toBe(false);
  });

  it('isolates a per-slug failure as a warning without blocking the others', async () => {
    const runWp = async (_s: string, args: string[]): Promise<string> => {
      const slug = args.find((a) => a.startsWith('--name='))?.slice('--name='.length);
      if (slug === 'hello-world') throw new Error('wp boom');
      return slug === 'sample-page' ? '2' : '';
    };
    const warnings = await deleteDefaultWpContent('/site', runWp);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/hello-world/);
  });
});
