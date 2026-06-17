// tools/lib/capture.mjs — Playwright capture + PNG comparison shared by both skills.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { isPathInside } from './workspace.mjs';
import * as profile from './profile.mjs';

// P2: count chromium launches per process and the total ms spent launching, so
// the relaunch-per-call tax (one browser per tool call, no pooling) is visible
// in the profile. A future browser pool would drive this count toward 1. All of
// this is inert when profiling is off — the counters update but nothing flushes.
let _browserLaunchCount = 0;
let _browserLaunchTotalMs = 0;

// Best-effort host extraction for span meta. file:// URLs and malformed strings
// fall back gracefully so instrumentation never throws on the hot path.
function _hostOf(url) {
    try {
        return new URL(url).host || 'file';
    } catch {
        return undefined;
    }
}

// P1 (behind isNet()): attach Playwright request capture to a page for the
// duration of one capture. Collects per-request { url, host, status, fromCache,
// encodedBodySize, timing } via requestfinished/requestfailed, then records an
// aggregate-per-host event (count, bytes, totalMs) plus the single slowest
// request. Returns a detach() that removes the listeners and records the
// aggregate. A no-op (returns a noop detach) unless isNet() is on. Strictly
// opt-in so default runs are byte-for-byte unaffected.
function _attachNetCapture(page, meta) {
    if (!profile.isNet()) return () => {};

    const perHost = new Map();
    let slowest = null;

    const durationOf = (timing) => {
        if (!timing) return 0;
        // Playwright timing: startTime is an absolute epoch (ms), but every other
        // field (requestStart, responseStart, responseEnd, …) is an OFFSET
        // relative to startTime, or -1 when unavailable. responseEnd is therefore
        // already the request's duration. The previous code computed
        // responseEnd - startTime — a relative offset minus an epoch — so the
        // `end >= start` guard always failed and every request measured 0 ms.
        const end = timing.responseEnd;
        return typeof end === 'number' && end >= 0 ? end : 0;
    };

    const onFinished = (request) => {
        try {
            const response = request.response && request.response();
            const recordReq = (status, fromCache, bytes) => {
                const url = request.url();
                const host = _hostOf(url) || 'unknown';
                const timing = request.timing ? request.timing() : null;
                const durMs = durationOf(timing);
                const bucket = perHost.get(host) || { count: 0, bytes: 0, totalMs: 0 };
                bucket.count += 1;
                bucket.bytes += Number.isFinite(bytes) ? bytes : 0;
                bucket.totalMs += durMs;
                perHost.set(host, bucket);
                if (!slowest || durMs > slowest.durMs) {
                    slowest = { url, host, status, fromCache, durMs, bytes: Number.isFinite(bytes) ? bytes : 0 };
                }
            };

            const settle = (resp) => {
                let status;
                let fromCache = false;
                let bytes = 0;
                if (resp) {
                    status = typeof resp.status === 'function' ? resp.status() : undefined;
                    if (typeof resp.fromCache === 'function') fromCache = resp.fromCache();
                }
                const sizes = request.sizes ? request.sizes() : null;
                if (sizes && typeof sizes.then === 'function') {
                    sizes.then((s) => recordReq(status, fromCache, s && s.responseBodySize), () => recordReq(status, fromCache, bytes));
                    return;
                }
                if (sizes && typeof sizes.responseBodySize === 'number') bytes = sizes.responseBodySize;
                recordReq(status, fromCache, bytes);
            };

            if (response && typeof response.then === 'function') {
                response.then(settle, () => settle(null));
            } else {
                settle(response);
            }
        } catch {
            // Never let request bookkeeping disturb the capture.
        }
    };

    const onFailed = (request) => {
        try {
            const url = request.url();
            const host = _hostOf(url) || 'unknown';
            const timing = request.timing ? request.timing() : null;
            const durMs = durationOf(timing);
            const bucket = perHost.get(host) || { count: 0, bytes: 0, totalMs: 0 };
            bucket.count += 1;
            bucket.totalMs += durMs;
            perHost.set(host, bucket);
            if (!slowest || durMs > slowest.durMs) {
                slowest = { url, host, status: undefined, fromCache: false, durMs, bytes: 0, failed: true };
            }
        } catch {
            // ignore
        }
    };

    page.on('requestfinished', onFinished);
    page.on('requestfailed', onFailed);

    return function detach() {
        try {
            page.off('requestfinished', onFinished);
            page.off('requestfailed', onFailed);
        } catch {
            // ignore
        }
        const hosts = {};
        for (const [host, bucket] of perHost) {
            hosts[host] = {
                count: bucket.count,
                bytes: bucket.bytes,
                totalMs: Number(bucket.totalMs.toFixed(2)),
            };
        }
        profile.record('capture.network', 0, {
            ...meta,
            hosts,
            requestCount: Array.from(perHost.values()).reduce((sum, b) => sum + b.count, 0),
            slowest: slowest
                ? { url: slowest.url, host: slowest.host, status: slowest.status, fromCache: slowest.fromCache, durMs: Number(slowest.durMs.toFixed(2)), bytes: slowest.bytes }
                : null,
        });
    };
}

// launchBrowser(chromium, options, meta): instrumented chromium.launch() wrapper.
// Times the launch ('capture.browser.launch'), bumps the P2 launch counter, and
// records an aggregate counter event with the running launch count + total ms.
// When profiling is off this is just `chromium.launch(options)` with the counters
// still ticking (cheap) but nothing recorded or flushed.
export async function launchBrowser(chromium, options = { headless: true }, meta) {
    const token = profile.mark('capture.browser.launch');
    const start = performance.now();
    try {
        const browser = await chromium.launch(options);
        const durMs = performance.now() - start;
        _browserLaunchCount += 1;
        _browserLaunchTotalMs += durMs;
        profile.measure(token, { ...meta, launchCount: _browserLaunchCount, headless: options && options.headless !== false });
        profile.record('capture.browser.launchCount', _browserLaunchTotalMs, {
            ...meta,
            count: _browserLaunchCount,
            totalMs: Number(_browserLaunchTotalMs.toFixed(2)),
            lastMs: Number(durMs.toFixed(2)),
        });
        return browser;
    } catch (err) {
        profile.measure(token, { ...meta, error: true });
        throw err;
    }
}

// Expose the launch tally for harness/reporting code without re-deriving it.
export function browserLaunchStats() {
    return { count: _browserLaunchCount, totalMs: _browserLaunchTotalMs };
}

export const DEFAULT_VIEWPORTS = [
    { name: 'desktop', width: 1440, height: 1200 },
    { name: 'mobile', width: 390, height: 1200 },
];

export async function loadCaptureDeps(pluginRoot) {
    try {
        const { chromium } = await import('playwright');
        const { PNG } = await import('pngjs');
        const pixelmatch = (await import('pixelmatch')).default;
        return { chromium, PNG, pixelmatch };
    } catch (error) {
        throw new Error(`Screenshot comparison needs optional packages. Run npm install in ${pluginRoot}. Missing dependency: ${error.message}`);
    }
}

export async function serveDirectory(rootDir) {
    const root = path.resolve(rootDir);
    const server = http.createServer((request, response) => {
        if (!['GET', 'HEAD'].includes(request.method || '')) {
            response.writeHead(405, { Allow: 'GET, HEAD' });
            response.end('Method not allowed');
            return;
        }

        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(requestUrl.pathname);
        const filePath = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
        if (!isPathInside(root, filePath)) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            response.writeHead(404);
            response.end('Not found');
            return;
        }

        response.writeHead(200, { 'Content-Type': mimeType(filePath) });
        if (request.method === 'HEAD') {
            response.end();
            return;
        }
        fs.createReadStream(filePath).pipe(response);
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return {
        urlFor(filePath) {
            const relative = path.relative(root, filePath).split(path.sep).map(encodeURIComponent).join('/');
            return `http://127.0.0.1:${port}/${relative}`;
        },
        close() {
            return new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        },
    };
}

function mimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return {
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
    }[ext] || 'application/octet-stream';
}

export async function captureUrl(browser, url, screenshotPath, viewport, { editor = false } = {}) {
    // Shared meta for every span this capture emits. No-op overhead when off.
    const kind = editor ? 'editor' : 'html';
    const meta = {
        kind,
        host: _hostOf(url),
        viewport: viewport && viewport.name ? viewport.name : `${viewport.width}x${viewport.height}`,
    };
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    // P1: attach network capture only when isNet(); detaches in finally.
    const detachNet = _attachNetCapture(page, meta);
    try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        // page.goto with waitUntil:'networkidle' couples navigation and the
        // networkidle settle into one awaited call, so it carries the full
        // navigate + networkidle tail. Labelled as the navigate span.
        await profile.span(
            'capture.navigate',
            () => page.goto(url, editor ? { waitUntil: 'networkidle', timeout: 60000 } : { waitUntil: 'networkidle' }),
            meta,
        );
        if (editor) {
            // The editor's networkidle is gated on the block-list layout (the 47
            // s.w.org scripts must register before the layout exists), so the
            // explicit wait for that selector is the separable networkidle tail.
            await profile.span(
                'capture.wait.networkidle',
                () => page.waitForSelector('.block-editor-block-list__layout', { timeout: 60000 }),
                meta,
            );
            const errorText = await page.locator('.wbdc-editor-error').textContent({ timeout: 250 }).catch(() => '');
            if (errorText && !/Loading WordPress block editor/i.test(errorText)) {
                throw new Error(`Editor preview failed before screenshot: ${errorText}`);
            }
            await page.addStyleTag({ content: editorComparisonCss() });
        } else {
            await page.addStyleTag({ content: `${motionFreezeCss()}\n${transientOverlayCaptureCss()}` });
        }
        await page.waitForTimeout(150);
        await profile.span(
            'capture.screenshot',
            () => page.screenshot({ path: screenshotPath, fullPage: viewport.fullPage !== false, animations: 'disabled' }),
            meta,
        );
    } finally {
        detachNet();
        await page.close();
    }
}

export async function capture(browser, htmlPath, screenshotPath, viewport) {
    await captureUrl(browser, pathToFileURL(htmlPath).href, screenshotPath, viewport);
}

export async function captureEditor(browser, editorUrl, screenshotPath, viewport) {
    await captureUrl(browser, editorUrl, screenshotPath, viewport, { editor: true });
}

export function editorComparisonCss() {
    // Hide editor chrome and freeze motion for the screenshot. Block margins
    // are deliberately NOT zeroed here: the preview's wbdc-parity layer already
    // neutralizes editor block-gap margins, and the workspace CSS owns the
    // document rhythm — zeroing with !important would erase that layout signal.
    return `
        ${motionFreezeCss()}
        ${transientOverlayCaptureCss()}
        .wbdc-editor-toolbar{display:none!important}
        .wbdc-editor-shell,.wbdc-editor-canvas,.is-root-container.block-editor-block-list__layout{min-height:0!important}
        .editor-styles-wrapper{padding:0!important}
        .block-editor-block-list__block::before,
        .block-editor-block-list__block::after,
        .block-editor-block-list__breadcrumb,
        .block-editor-block-list__insertion-point,
        .block-editor-block-contextual-toolbar,
        .block-editor-block-toolbar,
        .block-editor-inserter,
        .block-editor-warning,
        .components-placeholder,
        .block-editor-block-variation-picker,
        .block-editor-default-block-appender,
        .block-editor-block-list__empty-block-inserter,
        .components-popover{display:none!important}
        .block-editor-block-list__block,
        .block-editor-block-list__block.is-selected,
        .block-editor-block-list__block.has-child-selected{outline:0!important;box-shadow:none!important}
    `;
}

export function motionFreezeCss() {
    return '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
}

export function transientOverlayCaptureCss() {
    return `
        .loading-screen,
        .loading-fade,
        .preloader,
        .loader,
        .cookie-jar,
        [data-role="cookie-jar-pop-up"],
        [aria-label="Cookie"],
        [aria-label="Cookies"] {
            display: none !important;
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
        }

        .c-scrollbar {
            display: none !important;
        }
    `;
}

export function comparePngs({ target, mockupShot, candidateShot, diffShot, viewport, PNG, pixelmatch }) {
    return profile.span(
        'capture.comparePngs',
        () => {
            const mockup = PNG.sync.read(fs.readFileSync(mockupShot));
            const candidate = PNG.sync.read(fs.readFileSync(candidateShot));
            const width = Math.min(mockup.width, candidate.width);
            const height = Math.min(mockup.height, candidate.height);
            const diff = new PNG({ width, height });
            const mismatch = pixelmatch(
                cropPng(mockup, width, height, PNG).data,
                cropPng(candidate, width, height, PNG).data,
                diff.data,
                width,
                height,
                { threshold: 0.1 }
            );
            fs.writeFileSync(diffShot, PNG.sync.write(diff));
            return {
                target,
                viewport: viewport.name,
                size: `${viewport.width}x${viewport.height}`,
                mockup: mockupShot,
                candidate: candidateShot,
                ...(target === 'rendered' ? { rendered: candidateShot } : {}),
                ...(target === 'editor' ? { editor: candidateShot } : {}),
                diff: diffShot,
                mismatchPercent: Number(((mismatch / (width * height)) * 100).toFixed(2)),
                widthDelta: Math.abs(mockup.width - candidate.width),
                heightDelta: Math.abs(mockup.height - candidate.height),
            };
        },
        {
            target,
            kind: target === 'editor' ? 'editor' : 'html',
            viewport: viewport && viewport.name ? viewport.name : `${viewport.width}x${viewport.height}`,
        },
    );
}

export function cropPng(source, width, height, PNG) {
    if (source.width === width && source.height === height) return source;
    const cropped = new PNG({ width, height });
    for (let y = 0; y < height; y += 1) {
        const sourceStart = y * source.width * 4;
        const targetStart = y * width * 4;
        source.data.copy(cropped.data, targetStart, sourceStart, sourceStart + width * 4);
    }
    return cropped;
}
