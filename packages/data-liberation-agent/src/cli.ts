#!/usr/bin/env node
// src/cli.ts
//
// Three verbs: liberate a site, verify the copy, publish it.
//
import { createRequire } from 'node:module';
import { resolveOutputBase } from './lib/paths.js';

const args = process.argv.slice(2);
const version = ( createRequire( import.meta.url )( '../package.json' ) as { version: string } )
  .version;

function getArg(name: string): string | null {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const val = args[i + 1];
  if (val === undefined || val.startsWith('--')) return null;
  return val;
}

const HELP = `
  data-liberation — Liberate any website into a complete, portable HTML site

  Usage:
    data-liberation <url>              Liberate a website into a portable HTML site
    data-liberation compare <dir>      Verify a liberated copy against its source
    data-liberation publish <dir>      Publish a liberated site (--to spacefast)
    data-liberation mcp                Start MCP server (stdio transport)
    data-liberation --version          Show version

  Liberate options:
    --output <dir>       Output base directory (default: ~/data-liberation; override with --output or DLA_OUTPUT_DIR)
    --resume             Reuse artifacts already on disk instead of recapturing
    --screenshots        Also capture full-page + scrolled PNG screenshots
    --serve              Keep a local server running on the liberated site until
                         interrupted, for browsing it. Liberation writes the site
                         and exits without this.
    --no-learn-fluid     Skip the width sweep and freeze the layout at one width.
                         Learning is on by default: it keeps the copy reflowing
                         like the source instead of pinning it to the capture width.

  Compare options:
    --screenshots        Write source/liberated/diff PNGs as evidence. Pixel score
                         never decides pass/fail.

  Publish options:
    --to <target>        Where to publish. Targets: spacefast (default)
    --token <token>      Publish into your own account (or SPACEFAST_TOKEN).
                         Without it the publish is anonymous and returns a claim link.

  Environment:
    DLA_OUTPUT_DIR       Default output base directory
    SPACEFAST_TOKEN      Publish token for the spacefast target
`;

if (args[0] === 'mcp') {
  await import('./mcp-server.js');
} else if (args[0] === '--version') {
  console.log(version);
} else if (args[0] === '--help' || args.length === 0) {
  console.log(HELP);
} else if (args[0] === 'compare') {
  const directory = args[1];
  if (!directory || directory.startsWith('-')) {
    console.error('Error: directory required. Usage: data-liberation compare <dir> [--screenshots]');
    process.exit(1);
  }
  const { runCompare } = await import('./ui/compare.js');
  const report = await runCompare(directory, { screenshots: args.includes('--screenshots') });
  process.exit(report.pass ? 0 : 1);
} else if (args[0] === 'publish') {
  const directory = args[1];
  if (!directory || directory.startsWith('-')) {
    console.error('Error: directory required. Usage: data-liberation publish <dir> [--to <target>]');
    process.exit(1);
  }

  const { publishSite } = await import('./ui/publish.js');
  const { PublishError } = await import('./lib/publish/index.js');
  try {
    const result = await publishSite({
      directory,
      target: getArg('--to') ?? 'spacefast',
      token: getArg('--token') ?? process.env.SPACEFAST_TOKEN ?? undefined,
      log: (message) => process.stderr.write(`${message}\n`),
    });

    console.log(`Published ${result.files} files to ${result.target}.`);
    console.log(`Live: ${result.liveUrl}`);
    if (result.versionUrl) console.log(`Version: ${result.versionUrl}`);
    if (result.private) {
      console.log('This space is private by default, so the live URL returns 403 until access is granted.');
    }
    if (result.claim) {
      console.log(`Claim it to keep it: ${result.claim.url}`);
      if (result.claim.expiresAt) console.log(`Claim expires: ${result.claim.expiresAt}`);
    }
    for (const note of result.notes) console.log(`Note: ${note}`);
  } catch (error) {
    if (error instanceof PublishError) {
      console.error(error.message);
      if (error.requestId) console.error(`Request ID: ${error.requestId}`);
      process.exit(1);
    }
    throw error;
  }
} else {
  // A bare URL means full-site HTML liberation: every retained route becomes a
  // portable local site that runs on its own.
  const url = args.find((a: string) => !a.startsWith('-'));
  if (!url) {
    console.error('Error: URL required. Run with --help for usage.');
    process.exit(1);
  }

  const { liberateSite } = await import('./ui/liberate.js');
  const result = await liberateSite({
    url,
    outputBase: getArg('--output') || resolveOutputBase(),
    resume: args.includes('--resume'),
    screenshots: args.includes('--screenshots'),
    learnFluid: !args.includes('--no-learn-fluid'),
    serve: args.includes('--serve'),
    log: (message) => process.stderr.write(`${message}\n`),
  });

  const notes = [
    result.routesSkipped ? `${result.routesSkipped} reused` : '',
    result.routesFailed ? `${result.routesFailed} failed` : '',
  ].filter(Boolean);
  console.log(
    `Liberated ${result.routesCaptured + result.routesSkipped}/${result.routesDiscovered} routes` +
      (notes.length ? ` (${notes.join(', ')})` : ''),
  );
  console.log(`Site: ${result.websiteDir}`);

  const server = result.server;
  if (server) {
    console.log(`Serving: ${server.url}`);
    console.log('Press Ctrl+C to stop.');
    const stop = () => {
      void server.close().then(() => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } else {
    // Guidance goes to stderr so stdout stays the machine-readable result.
    process.stderr.write(`Browse it: data-liberation ${url} --resume --serve\n`);
  }
}
