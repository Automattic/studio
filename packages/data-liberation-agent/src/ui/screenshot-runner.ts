import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fetchSitemap } from '../lib/extraction/sitemap.js';
import { ExtractionLog } from '../lib/resume-state/index.js';
import { runCliScreenshot } from './screenshot.js';
import type { UrlType } from '../lib/extraction/sitemap.js';

interface RunnerOpts {
  url: string;
  output: string;
  types?: string[];
  limit?: number;
  concurrency?: number;
  browserRestartEvery?: number;
  cdpPort?: number;
  force?: boolean;
  verbose?: boolean;
  urlsFile?: string | null;
  nonInteractive: boolean;
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

export async function runScreenshotCli(opts: RunnerOpts): Promise<void> {
  mkdirSync(opts.output, { recursive: true });
  const log = new ExtractionLog(opts.output);
  if (!log.acquireLock()) {
    console.error('Error: another liberation workflow is already running in this output dir.');
    process.exit(1);
  }
  try {
    let urls: string[];
    if (opts.urlsFile) {
      if (!existsSync(opts.urlsFile)) {
        console.error(`Error: --urls-file not found: ${opts.urlsFile}`);
        process.exit(1);
      }
      urls = readFileSync(opts.urlsFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    } else {
      urls = await fetchSitemap(opts.url);
    }
    if (urls.length === 0) {
      console.error('No URLs found. Pass --urls-file <path> for explicit URL lists, or check sitemap.xml on the origin.');
      process.exit(1);
    }

    // Preflight warning for large sites
    if (!opts.nonInteractive && typeof opts.limit !== 'number' && urls.length > 500) {
      const estMin = Math.ceil(urls.length * 0.3);
      const estGb = (urls.length * 4 * 2 / 1024).toFixed(1);
      const answer = await ask(`This will capture ${urls.length} URLs (~${estMin} min, ~${estGb} GB). Continue? [y/N] `);
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('Cancelled.');
        process.exit(0);
      }
    }

    runCliScreenshot({
      urls,
      outputDir: opts.output,
      primaryUrl: opts.url,
      urlLabel: new URL(opts.url).hostname,
      types: opts.types as UrlType[] | undefined,
      limit: opts.limit,
      concurrency: opts.concurrency,
      browserRestartEvery: opts.browserRestartEvery,
      cdpPort: opts.cdpPort,
      force: opts.force,
      verbose: opts.verbose,
    });
  } finally {
    log.releaseLock();
  }
}
