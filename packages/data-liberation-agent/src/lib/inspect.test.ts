import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectSource } from './inspect.js';

const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));
let server: Server | undefined;

async function fixture(handler?: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  server = createServer(handler ?? ((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    if (path === '/sitemap.xml') {
      response.setHeader('content-type', 'application/xml');
      response.end(`<urlset><url><loc>http://localtest.me:${(server!.address() as { port: number }).port}/post/one</loc></url><url><loc>http://localtest.me:${(server!.address() as { port: number }).port}/products/two</loc></url><url><loc>http://localtest.me:${(server!.address() as { port: number }).port}/about</loc></url></urlset>`);
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><title>${path}</title><nav><a href="/about">About</a></nav><form action="/submit"><input name="q"></form><img src="https://cdn.example.test/image.jpg"><script src="/app.js">const fake = '<form><img>';</script><!-- <form> -->`);
  }));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://localtest.me:${(server.address() as { port: number }).port}/`;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

function runCli(url: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', CLI, 'inspect', url, '--discovery-limit', '3', '--sample-limit', '2'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('inspectSource', () => {
  it('uses safe HTTP discovery and representative bounded samples without writing a site', async () => {
    const url = await fixture();
    const result = await inspectSource(url, { discoveryLimit: 3, sampleLimit: 2 });

    expect(result.schemaVersion).toBe('1.0');
    expect(result.coverage.discovery).toEqual({ routes: 3, limit: 3, truncated: true });
    expect(result.coverage.sampling).toEqual({ routes: 2, attempted: 2, succeeded: 2, failed: 0, limit: 2, truncated: true, complete: false });
    expect(result.routes.types).toEqual({ homepage: 1, post: 1, product: 1 });
    expect(result.samples.map((sample) => sample.type)).toEqual(['homepage', 'post']);
    expect(result.samples[0].observations).toMatchObject({ forms: 1, images: 1, scripts: 1, externalResourceOrigins: ['https://cdn.example.test'] });
    expect(result.unknowns).toContain('Rendered layout and responsive reflow were not measured; inspection does not run the full browser capture pipeline.');
  });

  it('validates bounded options', async () => {
    await expect(inspectSource('https://example.com', { sampleLimit: 0 })).rejects.toThrow('sampleLimit must be an integer between 1 and 10');
  });

  it('prints only versioned JSON on stdout through the actual CLI', async () => {
    const url = await fixture();
    const result = await runCli(url);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Inspecting entry route');
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: '1.0', coverage: { discovery: { limit: 3 }, sampling: { limit: 2 } } });
  }, 30_000);

  it('does not sample nested sitemap documents and preserves distinct route URLs', async () => {
    const url = await fixture((request, response) => {
      const port = (server!.address() as { port: number }).port;
      const path = new URL(request.url ?? '/', 'http://fixture').pathname;
      if (path === '/sitemap.xml') {
        response.setHeader('content-type', 'application/xml');
        response.end(`<sitemapindex><sitemap><loc>http://localtest.me:${port}/child.xml?x=one&amp;y=two</loc></sitemap></sitemapindex>`);
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end('<nav><a href="/page/?variant=one">One</a><a href="/page/?variant=two">Two</a></nav>');
    });
    const result = await inspectSource(url, { discoveryLimit: 5, sampleLimit: 5 });

    expect(result.coverage.discovery).toMatchObject({ routes: 3, truncated: true });
    expect(result.samples.map((sample) => sample.url)).toContain(`${url}page/?variant=one`);
    expect(result.samples.map((sample) => sample.url)).toContain(`${url}page/?variant=two`);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'nested-sitemap-unvisited' }));
  });

  it('reports non-HTML and failed HTTP samples without invented observations or resource links', async () => {
    const url = await fixture((request, response) => {
      const path = new URL(request.url ?? '/', 'http://fixture').pathname;
      if (path === '/sitemap.xml') { response.end('<urlset/>'); return; }
      if (path === '/json') { response.setHeader('content-type', 'application/json'); response.end('{"form":"<form>"}'); return; }
      if (path === '/denied') { response.statusCode = 403; response.setHeader('content-type', 'text/html'); response.end('<form>denied</form>'); return; }
      if (path === '/missing') { response.statusCode = 404; response.setHeader('content-type', 'text/html'); response.end('<form>missing</form>'); return; }
      response.setHeader('content-type', 'text/html');
      response.end('<nav><a href="/json">JSON</a><a href="/denied">Denied</a><a href="/missing">Missing</a></nav><a href="https://outside.example.test/">external link</a><a href="mailto:a@example.test">mail</a><img src="https://cdn.example.test/a.jpg"><script src="https://scripts.example.test/a.js"></script>');
    });
    const result = await inspectSource(url, { discoveryLimit: 5, sampleLimit: 5 });
    const json = result.samples.find((sample) => sample.url.endsWith('/json'))!;
    const denied = result.samples.find((sample) => sample.url.endsWith('/denied'))!;
    const missing = result.samples.find((sample) => sample.url.endsWith('/missing'))!;

    expect(result.samples[0].observations.externalResourceOrigins).toEqual(['https://cdn.example.test', 'https://scripts.example.test']);
    expect(json).toMatchObject({ outcome: 'non-html', observations: { html: false, forms: null } });
    expect(denied).toMatchObject({ status: 403, outcome: 'http-error', observations: { html: false, forms: null } });
    expect(missing).toMatchObject({ status: 404, outcome: 'http-error', observations: { html: false, forms: null } });
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['sample-non-html', 'sample-http-status']));
  });

  it('counts failed requests separately and cancels a shared deadline through redirects and body reads', async () => {
    let connectionClosed = false;
    const url = await fixture((request, response) => {
      const path = new URL(request.url ?? '/', 'http://fixture').pathname;
      request.on('close', () => { connectionClosed = true; });
      if (path === '/') { setTimeout(() => { response.statusCode = 302; response.setHeader('location', '/entry'); response.end(); }, 550); return; }
      if (path === '/entry') { response.setHeader('content-type', 'text/html'); response.write('<title>slow'); setTimeout(() => response.end('</title>'), 700); return; }
      response.end();
    });
    const started = Date.now();
    await expect(inspectSource(url, { overallTimeoutMs: 1_000, requestTimeoutMs: 30_000 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_400);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connectionClosed).toBe(true);
  }, 10_000);

  it('reports a timed-out selected sample as failed rather than complete', async () => {
    const url = await fixture((request, response) => {
      const path = new URL(request.url ?? '/', 'http://fixture').pathname;
      if (path === '/sitemap.xml') { response.end(`<urlset><url><loc>http://localtest.me:${(server!.address() as { port: number }).port}/post/slow</loc></url></urlset>`); return; }
      if (path === '/post/slow') { setTimeout(() => response.end('late'), 1_500); return; }
      response.setHeader('content-type', 'text/html'); response.end('<title>entry</title>');
    });
    const result = await inspectSource(url, { sampleLimit: 2, requestTimeoutMs: 1_000, overallTimeoutMs: 5_000 });
    expect(result.coverage.sampling).toMatchObject({ attempted: 2, succeeded: 1, failed: 1, complete: false });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'sample-failed', url: expect.stringContaining('/post/slow') }));
  }, 10_000);
});
