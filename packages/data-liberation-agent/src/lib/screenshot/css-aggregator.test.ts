import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CssAggregator } from './css-aggregator.js';

const TMP = join(process.cwd(), '.tmp-test', 'css-agg');
beforeEach(() => rmSync(TMP, { recursive: true, force: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('CssAggregator', () => {
  it('dedupes identical stylesheet blocks across pages', async () => {
    const agg = new CssAggregator();
    await agg.add('a', '.x{color:red}');
    await agg.add('b', '.x{color:red}');
    await agg.add('c', '.y{color:blue}');
    const css = agg.toString();
    expect(css.match(/\.x\{color:red\}/g)?.length).toBe(1);
    expect(css).toContain('.y{color:blue}');
  });

  it('serializes safely under concurrent adds', async () => {
    const agg = new CssAggregator();
    await Promise.all(Array.from({ length: 20 }, (_, i) => agg.add(`p${i}`, `.r${i}{x:${i}}`)));
    for (let i = 0; i < 20; i++) expect(agg.toString()).toContain(`.r${i}{x:${i}}`);
  });

  it('writes site.css atomically and resumes from it', async () => {
    const agg = new CssAggregator();
    await agg.add('a', '.x{color:red}');
    agg.serialize(TMP);
    expect(existsSync(join(TMP, 'site.css'))).toBe(true);
    expect(readFileSync(join(TMP, 'site.css'), 'utf8')).toContain('.x{color:red}');

    const agg2 = new CssAggregator();
    agg2.init(TMP);                      // resume
    await agg2.add('b', '.x{color:red}'); // identical → still deduped
    await agg2.add('c', '.z{color:green}');
    const css = agg2.toString();
    expect(css.match(/\.x\{color:red\}/g)?.length).toBe(1);
    expect(css).toContain('.z{color:green}');
  });
});
