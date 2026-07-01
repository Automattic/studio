import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SEP = '\n/* --- dla-block --- */\n';

export class CssAggregator {
  private blocks = new Map<string, string>(); // hash -> css block (insertion-ordered)
  private chain: Promise<void> = Promise.resolve();

  init(outputDir: string): void {
    const p = join(outputDir, 'site.css');
    if (!existsSync(p)) return;
    try {
      for (const block of readFileSync(p, 'utf8').split(SEP)) {
        const css = block.trim();
        if (css) this.blocks.set(createHash('sha256').update(css).digest('hex'), css);
      }
    } catch { /* corrupt — start fresh */ }
  }

  add(_slug: string, css: string): Promise<void> {
    this.chain = this.chain.then(() => {
      const trimmed = css.trim();
      if (!trimmed) return;
      this.blocks.set(createHash('sha256').update(trimmed).digest('hex'), trimmed);
    });
    return this.chain;
  }

  toString(): string { return Array.from(this.blocks.values()).join(SEP); }

  serialize(outputDir: string): void {
    mkdirSync(outputDir, { recursive: true });
    const target = join(outputDir, 'site.css');
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, this.toString());
    renameSync(tmp, target);
  }
}
