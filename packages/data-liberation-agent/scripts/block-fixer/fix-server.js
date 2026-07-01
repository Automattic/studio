#!/usr/bin/env node

//
// Block Fixer HTTP Server (clustered)
// ====================================
// Runs as a persistent HTTP server so the JSDOM environment and WordPress
// block registry stay warm across requests, avoiding the cold-start cost
// of spawning a fresh node process per fix.
//
// Architecture is ported from telex's block-fixer (server/scripts/block-fixer/
// fix-html.js) but adapted for the data-liberation CLI's local-subprocess
// model: the parent CLI spawns this as a child process and talks to it
// over loopback. We bind to 127.0.0.1 (not 0.0.0.0) — there is no docker
// sidecar, no remote access, no network surface beyond the local CLI run.
//
// Wire:
//   POST /fix    { items: [<block html>, ...] }
//                → { results: [{ html, changed, fixedIssues }, ...] }
//   POST /raw    { items: [<raw html>, ...] }
//                → { results: [{ html, wpHtmlResidue }, ...] }
//   GET  /health → { status: 'ok', workers: N, pid }
//

const cluster = require('node:cluster');
const os = require('node:os');

const PORT = parseInt(process.env.BLOCK_FIXER_PORT || '3201', 10);
const HOST = process.env.BLOCK_FIXER_HOST || '127.0.0.1';
const WORKER_COUNT = parseInt(
  process.env.BLOCK_FIXER_WORKERS ||
    String(Math.min(os.availableParallelism?.() ?? os.cpus().length, 4)),
  10,
);

if (cluster.isPrimary) {
  console.error(
    `[block-fixer] Primary ${process.pid} starting ${WORKER_COUNT} workers on ${HOST}:${PORT}`,
  );

  const RESPAWN_DELAY_MS = 1000;
  let shuttingDown = false;

  for (let i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error(
      `[block-fixer] Worker ${worker.process.pid} exited (code=${code}, signal=${signal})`,
    );
    if (!shuttingDown) {
      console.error('[block-fixer] Respawning worker...');
      setTimeout(() => {
        if (!shuttingDown) cluster.fork();
      }, RESPAWN_DELAY_MS);
    }
  });

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('[block-fixer] Primary received SIGTERM, shutting down workers...');

    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill('SIGTERM');
    }

    setTimeout(() => {
      console.error('[block-fixer] Forcing exit after timeout');
      process.exit(0);
    }, 10_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  const http = require('http');
  const { JSDOM } = require('jsdom');

  // Set up DOM globals BEFORE importing @wordpress/blocks.
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.DOMParser = dom.window.DOMParser;
  global.XMLSerializer = dom.window.XMLSerializer;
  global.Node = dom.window.Node;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  global.matchMedia = () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    writable: true,
    configurable: true,
  });

  // Redirect console.log/warn → stderr so verbose @wordpress/blocks output
  // does not interfere with HTTP responses on stdout.
  console.log = (...args) => console.error(...args);
  console.warn = (...args) => console.error(...args);

  const { fixBlocksInTemplate } = require('./lib/blockFixer.js');
  const { convertHtmlToBlocks } = require('./lib/rawConvert.js');

  const MAX_BODY_BYTES = 4_194_304; // 4MB — generous; one composed page is ~30-130KB

  function handleFix(body) {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      return { status: 400, body: { error: 'Invalid JSON: ' + e.message } };
    }

    if (!Array.isArray(payload.items)) {
      return { status: 400, body: { error: 'Missing or invalid "items" array' } };
    }

    const results = payload.items.map((html) => {
      if (typeof html !== 'string') {
        return { html: '', changed: false, fixedIssues: [] };
      }
      return fixBlocksInTemplate(html);
    });

    return { status: 200, body: { results } };
  }

  function handleRaw(body) {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      return { status: 400, body: { error: 'Invalid JSON: ' + e.message } };
    }
    if (!Array.isArray(payload.items)) {
      return { status: 400, body: { error: 'Missing or invalid "items" array' } };
    }
    const results = payload.items.map((html) => {
      if (typeof html !== 'string') return { html: '', wpHtmlResidue: Infinity };
      return convertHtmlToBlocks(html);
    });
    return { status: 200, body: { results } };
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', workers: WORKER_COUNT, pid: process.pid }));
      return;
    }

    if (req.method === 'POST' && req.url === '/fix') {
      const chunks = [];
      let totalBytes = 0;

      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (res.writableEnded) return;
        const body = Buffer.concat(chunks).toString('utf-8');
        const result = handleFix(body);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      });

      req.on('error', (err) => {
        console.error('[block-fixer] Request error:', err.message);
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });

      return;
    }

    if (req.method === 'POST' && req.url === '/raw') {
      const chunks = [];
      let totalBytes = 0;

      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (res.writableEnded) return;
        const body = Buffer.concat(chunks).toString('utf-8');
        const result = handleRaw(body);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      });

      req.on('error', (err) => {
        console.error('[block-fixer] Request error:', err.message);
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });

      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(PORT, HOST, () => {
    console.error(`[block-fixer] Worker ${process.pid} listening on ${HOST}:${PORT}`);
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}
