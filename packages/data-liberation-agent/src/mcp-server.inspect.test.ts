import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectSource } from './lib/inspect.js';

const SERVER = fileURLToPath(new URL('./mcp-server.ts', import.meta.url));
let fixture: Server | undefined;

async function startFixture(): Promise<string> {
  fixture = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    if (path === '/sitemap.xml') {
      const port = (fixture!.address() as { port: number }).port;
      response.end(`<urlset><url><loc>http://localtest.me:${port}/post/one</loc></url></urlset>`);
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end('<title>fixture</title><form></form>');
  });
  await new Promise<void>((resolve) => fixture!.listen(0, '127.0.0.1', resolve));
  return `http://localtest.me:${(fixture.address() as { port: number }).port}/`;
}

afterEach(async () => {
  if (fixture) await new Promise<void>((resolve, reject) => fixture!.close((error) => error ? reject(error) : resolve()));
  fixture = undefined;
});

function inspectViaMcp(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('MCP inspect did not answer'));
    }, 30_000);
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      for (const line of buffer.split('\n')) {
        try {
          const message = JSON.parse(line) as { id?: number; result?: { content?: Array<{ text: string }> } };
          if (message.id === 3 && message.result?.content?.[0]) {
            clearTimeout(timer);
            child.kill();
            resolve(JSON.parse(message.result.content[0].text));
          }
        } catch { /* partial line */ }
      }
    });
    child.on('error', reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'inspect', arguments: { url, discoveryLimit: 2, sampleLimit: 1 } } })}\n`);
  });
}

describe('MCP inspect', () => {
  it('returns the public inspection result through the inspect tool', async () => {
    const url = await startFixture();
    const expected = await inspectSource(url, { discoveryLimit: 2, sampleLimit: 1 });
    const result = await inspectViaMcp(url);
    expect(result).toMatchObject({
      schemaVersion: expected.schemaVersion,
      source: expected.source,
      coverage: expected.coverage,
      routes: expected.routes,
      samples: expected.samples,
      unknowns: expected.unknowns,
      issues: expected.issues,
    });
  }, 45_000);
});
