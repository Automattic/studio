// src/lib/preview/editor-preview.ts
//
// BDC Task 5 — editor-fidelity measurement surface (MEASURE-ONLY).
// ===============================================================
// A SECOND comparison surface: render emitted block markup in the REAL
// WordPress block editor (Route A — a live Studio site, resolved by the
// 2026-06-15 probe; the live s.w.org CDN harness was rejected as it bakes
// network non-determinism into a test, against the project determinism gate)
// and pixelmatch the editor canvas against the source screenshot. This catches
// editor-only drift (a block that renders fine on the frontend but breaks /
// shifts in the editor) that the frontend surface is blind to.
//
// Verdict policy (editorScorePolicy): blocks-path core-only output feeds the
// verdict; local-site carry output is WARN-only (the editor lacks the carried
// source CSS so it renders structurally but unstyled); any page carrying dla/*
// blocks is SKIPPED (they render as accepted missing-block placeholders in the
// editor — scoring them measures the placeholder, not our markup).
//
// Auth: the editor is login-gated. Credentials arrive via opts (never hardcoded
// / committed); the handler/driver sources them from the environment.
//
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page, Frame } from 'playwright';
import { scoreViewportPair, type ViewportScore, type RepairTask, type ViewportId } from '../screenshot/compare.js';
import { studioWp as studioWpExec } from './studio.js';
import { connectBrowser } from '../browser-kit/index.js';

// ---------------------------------------------------------------------------
// Pure helpers (hermetically tested)
// ---------------------------------------------------------------------------

/** Injected into the editor canvas iframe so its screenshot matches the
 * no-title frontend template: hide the post title (not part of post_content)
 * and the block inserter/appender chrome the editor adds around content. */
export const EDITOR_CANVAS_NEUTRALIZE_CSS = [
  '.wp-block-post-title, .editor-post-title, .edit-post-visual-editor__post-title-wrapper { display:none !important; }',
  '.block-editor-block-list__insertion-point, .block-list-appender, .block-editor-default-block-appender { display:none !important; }',
  '.block-editor-block-list__layout { margin-top:0 !important; }',
].join('\n');

/** True when the markup opens any dla/* interactivity block (editor renders
 * those as missing-block placeholders → must be skipped, not scored). Matches
 * the block OPENER only, so prose mentioning "dla/" never trips it. */
export function markupHasDlaBlocks(markup: string): boolean {
  return /<!--\s+wp:dla\//.test(markup);
}

export type EditorScoreMode = 'verdict' | 'warn' | 'skip-dla';

/** Decide how a page's editor score is used. dla/* presence forces skip
 * regardless of path (placeholder render); else blocks-path joins the verdict,
 * carry path is warn-only (editor renders unstyled — no carried source CSS). */
export function editorScorePolicy(opts: { blocksPath: boolean; hasDlaBlocks: boolean }): { mode: EditorScoreMode } {
  if (opts.hasDlaBlocks) return { mode: 'skip-dla' };
  return { mode: opts.blocksPath ? 'verdict' : 'warn' };
}

/** Build one editor-surface RepairTask from a scored editor canvas, or null
 * when the page passes / could not be scored. Mirrors buildRepairTasks'
 * height-first precedence (compare.ts). */
export function buildEditorRepairTask(
  pathname: string,
  viewport: ViewportId,
  score: ViewportScore,
  floor: number,
): RepairTask | null {
  if (score.status !== 'ok' || score.score === null) return null;
  const heightFail = score.heightPass === false;
  const scoreFail = score.score < floor;
  if (!heightFail && !scoreFail) return null;
  return {
    surface: 'editor',
    pathname,
    viewport,
    kind: heightFail ? 'height' : 'mismatch',
    score: score.score,
    heightDelta: score.heightDelta ?? null,
  };
}

// ---------------------------------------------------------------------------
// Live editor session (Route A — integration, env-gated tests + .tmp-test driver)
// ---------------------------------------------------------------------------

export interface EditorSessionOpts {
  /** Live site base URL (Studio assigns ports per launch — resolve, don't hardcode). */
  wpUrl: string;
  /** On-disk site path for wp-cli draft create/delete (the reliable inject path). */
  sitePath: string;
  username: string;
  password: string;
  /** Canvas viewport; width drives the editor canvas width. Default 1280x1200. */
  viewport?: { width: number; height: number };
  /** Reuse an externally-managed browser (the session won't close it). */
  browser?: Browser;
}

export interface EditorSession {
  /** Render one markup string in the editor canvas → PNG buffer. */
  render(markup: string): Promise<Buffer>;
  close(): Promise<void>;
}

/** Thin trimming wrapper over the shared Studio wp-cli exec — short commands,
 * so the 60s/10MB envelope rather than the 5min/50MB default. */
async function studioWp(sitePath: string, args: string[]): Promise<string> {
  return (await studioWpExec(sitePath, args, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 })).trim();
}

/** Log in ONCE and return a session that can render many markup strings (the
 * handler renders N pages — amortize the login). Each render() creates a throw-
 * away draft, screenshots the canvas, and deletes the draft. */
export async function openEditorSession(opts: EditorSessionOpts): Promise<EditorSession> {
  const viewport = opts.viewport ?? { width: 1280, height: 1200 };
  let browser = opts.browser;
  let ownsBrowser = false;
  if (!browser) {
    browser = await connectBrowser({});
    ownsBrowser = true;
  }
  const context = await browser.newContext({ viewport });
  const page: Page = await context.newPage();

  // Log in via the form (Studio sites are auth-gated; no auto-auth cookie).
  await page.goto(`${opts.wpUrl}/wp-login.php`, { waitUntil: 'domcontentloaded' });
  await page.fill('#user_login', opts.username);
  await page.fill('#user_pass', opts.password);
  await page.click('#wp-submit');
  await page.waitForLoadState('networkidle');
  if (/wp-login\.php/.test(page.url())) {
    await context.close();
    if (ownsBrowser) await browser.close();
    throw new Error('editor login failed (still on wp-login.php) — check credentials');
  }

  const render = async (markup: string): Promise<Buffer> => {
    const postId = await studioWp(opts.sitePath, [
      'post', 'create', '--post_type=page', '--post_status=draft',
      '--post_title=__lib_editor_probe__', `--post_content=${markup}`, '--porcelain',
    ]);
    try {
      await page.goto(`${opts.wpUrl}/wp-admin/post.php?post=${postId}&action=edit`, { waitUntil: 'domcontentloaded' });
      // Dismiss the welcome guide modal if it pops (best-effort; blocks the canvas otherwise).
      await page.keyboard.press('Escape').catch(() => {});
      const canvas: Frame | null = await waitForCanvasFrame(page);
      if (!canvas) throw new Error(`editor canvas iframe never appeared for post ${postId}`);
      await canvas.waitForSelector('.block-editor-block-list__layout', { timeout: 15_000 });
      await canvas.addStyleTag({ content: EDITOR_CANVAS_NEUTRALIZE_CSS });
      // Let layout settle after the title is removed.
      await page.waitForTimeout(400);
      const target = await canvas.$('.block-editor-block-list__layout');
      if (!target) throw new Error('block-list layout missing after neutralize');
      return await target.screenshot();
    } finally {
      await studioWp(opts.sitePath, ['post', 'delete', postId, '--force']).catch(() => {});
    }
  };

  const close = async (): Promise<void> => {
    await context.close();
    if (ownsBrowser && browser) await browser.close();
  };

  return { render, close };
}

/** Wait for the modern WP editor-canvas iframe (block content lives inside it). */
async function waitForCanvasFrame(page: Page): Promise<Frame | null> {
  for (let i = 0; i < 30; i++) {
    const frame = page.frame({ name: 'editor-canvas' });
    if (frame) return frame;
    await page.waitForTimeout(250);
  }
  // Pre-iframe WP fallback: content sits in the top document.
  return page.mainFrame();
}

/** Convenience single-shot: open a session, render one markup, close. The
 * env-gated integration test uses this; the handler uses openEditorSession. */
export async function renderEditorCanvas(markup: string, opts: EditorSessionOpts): Promise<Buffer> {
  const session = await openEditorSession(opts);
  try {
    return await session.render(markup);
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Surface orchestration (one editor score per page → report + repair tasks)
// ---------------------------------------------------------------------------

export interface EditorSurfacePage {
  pathname: string;
  slug: string;
  markup: string;
  /** Blocks-path output joins the verdict; carry output is warn-only. */
  blocksPath: boolean;
  /** Source desktop screenshot to score against; null → render-only (no score). */
  sourceShotDesktop: string | null;
}

export interface EditorPageScore {
  pathname: string;
  mode: EditorScoreMode;
  /** null = not scored (skip-dla, no source shot, or render/decode failure). */
  editorScore: number | null;
  heightDelta: number | null;
  reason?: string;
}

export interface EditorSurfaceResult {
  results: EditorPageScore[];
  /** surface:'editor' tasks for sub-floor VERDICT-mode pages (warn-mode pages
   * are measured but never produce repair tasks — they can't fail the build). */
  repairTasks: RepairTask[];
}

/**
 * Render + score every page through the editor surface. dla/* pages are skipped
 * (placeholder render); pages with no source shot are rendered but unscored.
 * Editor canvas PNGs land in `<diffDir>/editor/<slug>.desktop.png`. Pure
 * orchestration over the injected session + scorer — the handler owns creds,
 * page assembly, and report persistence.
 */
export async function scoreEditorSurface(opts: {
  session: EditorSession;
  pages: EditorSurfacePage[];
  floor: number;
  diffDir: string;
}): Promise<EditorSurfaceResult> {
  const results: EditorPageScore[] = [];
  const repairTasks: RepairTask[] = [];
  const editorDir = join(opts.diffDir, 'editor');
  for (const pg of opts.pages) {
    const { mode } = editorScorePolicy({ blocksPath: pg.blocksPath, hasDlaBlocks: markupHasDlaBlocks(pg.markup) });
    if (mode === 'skip-dla') {
      results.push({ pathname: pg.pathname, mode, editorScore: null, heightDelta: null, reason: 'placeholder sections (dla/*)' });
      continue;
    }
    let pngPath: string;
    try {
      const png = await opts.session.render(pg.markup);
      mkdirSync(editorDir, { recursive: true });
      pngPath = join(editorDir, `${pg.slug}.desktop.png`);
      writeFileSync(pngPath, png);
    } catch (err) {
      results.push({ pathname: pg.pathname, mode, editorScore: null, heightDelta: null, reason: `render failed: ${(err as Error).message}` });
      continue;
    }
    if (!pg.sourceShotDesktop) {
      results.push({ pathname: pg.pathname, mode, editorScore: null, heightDelta: null, reason: 'no source screenshot' });
      continue;
    }
    const diffPath = join(editorDir, `${pg.slug}.desktop.diff.png`);
    const score = scoreViewportPair(pg.sourceShotDesktop, pngPath, 'desktop', diffPath);
    results.push({ pathname: pg.pathname, mode, editorScore: score.score, heightDelta: score.heightDelta ?? null });
    // Only verdict-mode failures become repair tasks (warn-mode is metric-only).
    if (mode === 'verdict') {
      const task = buildEditorRepairTask(pg.pathname, 'desktop', score, opts.floor);
      if (task) repairTasks.push(task);
    }
  }
  return { results, repairTasks };
}
