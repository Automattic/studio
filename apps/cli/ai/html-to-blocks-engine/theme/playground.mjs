// tools/theme/playground.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolvePath, readJson, writeJson } from '../lib/workspace.mjs';
import { loadCaptureDeps, serveDirectory, captureUrl, comparePngs, DEFAULT_VIEWPORTS } from '../lib/capture.mjs';
import { PLUGIN_ROOT } from '../lib/workspace.mjs';

export function buildBlueprint({ slug, hasBlocksPlugin }) {
    const prefix = slug.replace(/-/g, '_') + '_content';
    return {
        landingPage: '/',
        steps: [
            ...(hasBlocksPlugin ? [{ step: 'activatePlugin', pluginPath: `${slug}-blocks/${slug}-blocks.php` }] : []),
            { step: 'activatePlugin', pluginPath: `${slug}-content/${slug}-content.php` },
            { step: 'activateTheme', themeFolderName: slug },
            // wp_set_current_user(1): without unfiltered_html, kses strips the
            // form/select/input markup from imported page content — a real
            // admin clicking the Import button has that capability
            { step: 'runPHP', code: `<?php require '/wordpress/wp-load.php'; wp_set_current_user(1); var_export(${prefix}_import_pages());` },
        ],
    };
}

export function buildCliArgs({ slug, themeDir, pluginDirs, blueprintPath, port }) {
    return [
        'server',
        `--port=${port}`,
        `--blueprint=${blueprintPath}`,
        `--mount=${themeDir}:/wordpress/wp-content/themes/${slug}`,
        ...pluginDirs.map((dir) => `--mount=${dir}:/wordpress/wp-content/plugins/${path.basename(dir)}`),
    ];
}

export function pageUrl(base, page) {
    return page.front ? `${base}/` : `${base}/?pagename=${page.slug}`;
}

export async function playgroundRender(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const slug = args.slug;
    const themeDir = path.join(workspaceRoot, 'theme', slug);
    const blocksDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`);
    const contentDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-content`);
    const manifest = readJson(path.join(contentDir, 'content/manifest.json'));
    const hasBlocksPlugin = fs.existsSync(blocksDir);
    const port = args.port || 9400;
    const base = `http://127.0.0.1:${port}`;
    const outDir = path.join(workspaceRoot, 'reports/playground');
    fs.mkdirSync(outDir, { recursive: true });

    const blueprintPath = path.join(outDir, 'blueprint.json');
    writeJson(blueprintPath, buildBlueprint({ slug, hasBlocksPlugin }));
    const proc = spawn('npx', ['@wp-playground/cli', ...buildCliArgs({
        slug, themeDir, blueprintPath, port,
        pluginDirs: [blocksDir, contentDir].filter((d) => fs.existsSync(d)),
    })], { cwd: PLUGIN_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    proc.stdout.on('data', (d) => { logs += d; });
    proc.stderr.on('data', (d) => { logs += d; });

    try {
        await waitForServer(base, 120000, () => proc.exitCode);
        // the server answers before the blueprint's runPHP import step finishes;
        // capturing early races the import (front page = blog index). The last
        // manifest page resolving proves the import ran to completion.
        const lastPage = manifest.pages[manifest.pages.length - 1];
        if (lastPage) await waitForImport(pageUrl(base, { ...lastPage, front: false }), 120000, () => proc.exitCode);
        const { chromium, PNG, pixelmatch } = await loadCaptureDeps(PLUGIN_ROOT);
        const browser = await chromium.launch({ headless: true });
        const server = await serveDirectory(workspaceRoot); // mockup screenshots through the same pipeline
        const thresholds = { maxMismatchPercent: args.maxMismatchPercent ?? 1, maxHeightDelta: args.maxHeightDelta ?? 8 };
        const pagesReport = [];
        try {
            for (const page of manifest.pages) {
                const mockupPath = page.mockupPath || inferMockupPath(workspaceRoot, page);
                const results = [];
                for (const viewport of args.viewports || DEFAULT_VIEWPORTS) {
                    const mockShot = path.join(outDir, `${page.slug}-mockup-${viewport.name}.png`);
                    const wpShot = path.join(outDir, `${page.slug}-wp-${viewport.name}.png`);
                    const diffShot = path.join(outDir, `${page.slug}-diff-${viewport.name}.png`);
                    await captureUrl(browser, server.urlFor(path.join(workspaceRoot, mockupPath)), mockShot, viewport);
                    await captureUrl(browser, pageUrl(base, page), wpShot, viewport);
                    results.push(comparePngs({ target: 'wordpress', mockupShot: mockShot, candidateShot: wpShot, diffShot, viewport, PNG, pixelmatch }));
                }
                const aggregate = {
                    maxMismatchPercent: Math.max(...results.map((r) => r.mismatchPercent)),
                    maxHeightDelta: Math.max(...results.map((r) => r.heightDelta)),
                };
                pagesReport.push({ page: page.slug, mockupPath, results, aggregate,
                    passed: aggregate.maxMismatchPercent <= thresholds.maxMismatchPercent && aggregate.maxHeightDelta <= thresholds.maxHeightDelta });
            }
            // editor validation: the real editor recomputes save() in the
            // browser and flags drift our Node round-trip cannot see (kses
            // escaping, content-filter mangling). Zero failures required.
            await editorValidation(browser, base, manifest.pages, pagesReport);
        } finally {
            await browser.close();
            await server.close?.();
        }
        const report = {
            generatedAt: new Date().toISOString(), thresholds, pages: pagesReport,
            aggregates: {
                maxMismatchPercent: Math.max(...pagesReport.map((p) => p.aggregate.maxMismatchPercent)),
                maxHeightDelta: Math.max(...pagesReport.map((p) => p.aggregate.maxHeightDelta)),
            },
            passed: pagesReport.every((p) => p.passed && (p.editorValidation?.failures ?? 0) === 0),
        };
        writeJson(path.join(workspaceRoot, 'reports/theme-comparison.json'), report);
        return report;
    } catch (error) {
        throw new Error(`playground_render failed: ${error.message}\n--- playground logs (tail) ---\n${logs.slice(-2000)}`);
    } finally {
        proc.kill('SIGTERM');
    }
}

async function editorValidation(browser, base, pages, pagesReport) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        await page.goto(`${base}/wp-login.php`);
        await page.fill('#user_login', 'admin');
        await page.fill('#user_pass', 'password');
        await page.click('#wp-submit');
        await page.waitForLoadState('networkidle');
        for (const manifestPage of pages) {
            const entry = pagesReport.find((p) => p.page === manifestPage.slug);
            if (!entry) continue;
            const failures = [];
            const onConsole = (msg) => {
                const text = msg.text();
                if (/Block validation failed/i.test(text)) {
                    failures.push(text.slice(0, 300));
                }
            };
            page.on('console', onConsole);
            // resolve the post id from the editor list is brittle; the edit
            // link on the frontend admin bar is too — use post slug query
            await page.goto(`${base}/wp-admin/edit.php?post_type=page&s=${encodeURIComponent(manifestPage.title)}`);
            const editHref = await page.getAttribute('.row-title >> nth=0', 'href').catch(() => null);
            if (editHref) {
                await page.goto(editHref);
                await page.waitForSelector('.block-editor-block-list__layout', { timeout: 60000 }).catch(() => {});
                await page.waitForTimeout(2000);
            } else {
                failures.push(`could not locate the page "${manifestPage.title}" in wp-admin`);
            }
            page.off('console', onConsole);
            entry.editorValidation = { failures: failures.length, samples: failures.slice(0, 3) };
            if (failures.length > 0) entry.passed = false;
        }
    } finally {
        await context.close();
    }
}

async function waitForServer(base, timeoutMs, exited) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (exited() !== null) throw new Error('playground process exited before becoming ready');
        try {
            const res = await fetch(base, { redirect: 'manual' });
            if (res.status < 500) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`playground server not ready after ${timeoutMs}ms`);
}

async function waitForImport(url, timeoutMs, exited) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (exited() !== null) throw new Error('playground process exited during content import');
        try {
            const res = await fetch(url, { redirect: 'manual' });
            if (res.status === 200) return;
        } catch { /* still importing */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`content import did not complete within ${timeoutMs}ms (${url} never returned 200)`);
}

function inferMockupPath(workspaceRoot, page) {
    for (const candidate of [`mockup/${page.sourceFile || ''}`, `mockup/${page.page || page.slug}.html`, 'mockup/index.html']) {
        if (candidate !== 'mockup/' && fs.existsSync(path.join(workspaceRoot, candidate))) return candidate;
    }
    throw new Error(`No mockup found for page ${page.slug}; pass mockupPath in the manifest page entry.`);
}
