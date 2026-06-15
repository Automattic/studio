// tools/lib/capture.mjs — Playwright capture + PNG comparison shared by both skills.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPathInside } from './workspace.mjs';

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
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(url, editor ? { waitUntil: 'networkidle', timeout: 60000 } : { waitUntil: 'networkidle' });
        if (editor) {
            await page.waitForSelector('.block-editor-block-list__layout', { timeout: 60000 });
            const errorText = await page.locator('.wbdc-editor-error').textContent({ timeout: 250 }).catch(() => '');
            if (errorText && !/Loading WordPress block editor/i.test(errorText)) {
                throw new Error(`Editor preview failed before screenshot: ${errorText}`);
            }
            await page.addStyleTag({ content: editorComparisonCss() });
        } else {
            await page.addStyleTag({ content: `${motionFreezeCss()}\n${transientOverlayCaptureCss()}` });
        }
        await page.waitForTimeout(150);
        await page.screenshot({ path: screenshotPath, fullPage: viewport.fullPage !== false, animations: 'disabled' });
    } finally {
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
