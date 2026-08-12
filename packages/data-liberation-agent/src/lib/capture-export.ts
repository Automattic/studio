import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { MediaStubStore } from './resume-state/index.js';

export const CAPTURE_RECEIPT_SCHEMA = 'data-liberation/capture-receipt/v1';

interface CaptureManifestEntry {
  html?: string;
}

interface ScreenshotManifest {
  version: 1;
  entries: Record<string, CaptureManifestEntry>;
}

interface ExportCaptureOptions {
  outputDir: string;
  sourceUrl: string;
  platform: string;
  title?: string;
  summary: Record<string, unknown>;
  failures: Array<{ url: unknown; error: unknown }>;
}

function pathWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

function routeOutputPath(url: string, sourceUrl: string): string {
  const route = new URL(url);
  const source = new URL(sourceUrl);
  let pathname = decodeURIComponent(route.pathname);
  const sourcePath = source.pathname.replace(/\/$/, '');

  if (route.origin === source.origin && sourcePath && pathname.startsWith(`${sourcePath}/`)) {
    pathname = pathname.slice(sourcePath.length);
  } else if (route.origin === source.origin && pathname.replace(/\/$/, '') === sourcePath) {
    pathname = '/';
  }

  const cleanPath = pathname.replace(/^\/+|\/+$/g, '');
  if (!cleanPath) return 'index.html';
  if (/\.[a-z0-9]+$/i.test(cleanPath)) return cleanPath;
  return join(cleanPath, 'index.html');
}

function replaceAll(content: string, replacements: Map<string, string>): string {
  for (const [source, local] of replacements) {
    content = content.split(source).join(local);
    content = content.split(source.replace(/&/g, '&amp;')).join(local.replace(/&/g, '&amp;'));
  }
  return content;
}

export function exportWebsiteCapture(options: ExportCaptureOptions): string {
  const outputDir = resolve(options.outputDir);
  const screenshotManifestPath = join(outputDir, 'screenshots', 'manifest.json');
  if (!existsSync(screenshotManifestPath)) {
    throw new Error(`Screenshot manifest not found: ${screenshotManifestPath}`);
  }

  const capture = JSON.parse(readFileSync(screenshotManifestPath, 'utf8')) as ScreenshotManifest;
  if (capture.version !== 1 || !capture.entries || typeof capture.entries !== 'object') {
    throw new Error(`Invalid screenshot manifest: ${screenshotManifestPath}`);
  }

  const websiteDir = join(outputDir, 'website');
  rmSync(websiteDir, { recursive: true, force: true });
  mkdirSync(websiteDir, { recursive: true });

  const mediaReplacements = new Map<string, string>();
  const assets: Array<{ sourceUrl: string; path: string }> = [];
  for (const [sourceUrl, stub] of MediaStubStore.load(outputDir).list()) {
    if (stub.status !== 'success' || !stub.localPath || !existsSync(stub.localPath)) continue;
    const assetPath = join('media', basename(stub.localPath));
    const destination = join(websiteDir, assetPath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(stub.localPath, destination);
    mediaReplacements.set(sourceUrl, `/${assetPath.replace(/\\/g, '/')}`);
    assets.push({ sourceUrl, path: join('website', assetPath).replace(/\\/g, '/') });
  }

  const routes: Array<{ url: string; path: string }> = [];
  const claimedPaths = new Set<string>();
  for (const [url, entry] of Object.entries(capture.entries)) {
    if (!entry.html) continue;
    const htmlPath = resolve(outputDir, entry.html);
    if (!pathWithin(outputDir, htmlPath) || !existsSync(htmlPath)) continue;

    const routePath = routeOutputPath(url, options.sourceUrl).replace(/\\/g, '/');
    if (claimedPaths.has(routePath)) {
      throw new Error(`Captured routes resolve to the same website path: ${routePath}`);
    }
    claimedPaths.add(routePath);

    const destination = join(websiteDir, routePath);
    if (!pathWithin(websiteDir, destination)) {
      throw new Error(`Captured route escapes the website directory: ${url}`);
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, replaceAll(readFileSync(htmlPath, 'utf8'), mediaReplacements));
    routes.push({ url, path: `website/${routePath}` });
  }

  if (!existsSync(join(websiteDir, 'index.html'))) {
    throw new Error(`Capture does not contain rendered HTML for the source URL: ${options.sourceUrl}`);
  }

  const receiptPath = join(outputDir, 'capture-receipt.json');
  writeFileSync(receiptPath, `${JSON.stringify({
    schema: CAPTURE_RECEIPT_SCHEMA,
    websiteRoot: 'website',
    entrypoint: 'website/index.html',
    source: { url: options.sourceUrl, platform: options.platform },
    ...(options.title ? { title: options.title } : {}),
    routes,
    assets,
    summary: options.summary,
  }, null, 2)}\n`);
  writeFileSync(join(outputDir, 'diagnostics.json'), `${JSON.stringify({
    schema: 'data-liberation/capture-diagnostics/v1',
    failures: options.failures,
  }, null, 2)}\n`);

  return receiptPath;
}
