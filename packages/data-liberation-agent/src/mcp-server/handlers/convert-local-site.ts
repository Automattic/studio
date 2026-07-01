// src/mcp-server/handlers/convert-local-site.ts
//
// liberate_convert_local_site
// ===========================
// Stage 1b+1c of the owned-source path: take a local static site through to a
// LIVE Studio site — reuse stage 1a (ingest → composed sidecars), optionally
// capture the source site's design tokens + screenshots, assemble the local
// block theme (nav-graph header, captured footer, foundation-styled, no-title
// page templates), write + activate it, create WP Pages from the sidecars
// (idempotent via _source_url), set the front page, assign the page-local
// template, optionally capture the WP replica and score parity.
//
import { existsSync, readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync, mkdirSync, copyFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { isTag } from 'domhandler';
import type { Element as DomElement } from 'domhandler';
import type { Handler } from '../handler-types.js';
import { ingestLocalSiteHandler } from './ingest-local-site.js';
import {
  JETPACK_FORMS_MODULE_ACTIVATE,
  JETPACK_FORMS_PLUGIN_INSTALL,
  jetpackFormsModuleActivateWarning,
  jetpackFormsPluginInstallWarning,
  shouldInstallJetpackFormsPlugin,
} from './convert-local-site-jetpack-contract.js';
import { themeCacheFlushCommands } from './install-theme.js';
import { ingestLocalSite } from '../../lib/replicate/local-site/ingest.js';
import type { InteriorChromeTemplate } from '../../lib/replicate/local-theme/interior-chrome.js';
import { buildPagePlan } from '../../lib/replicate/local-theme/page-plan.js';
import { writeReplicaFilesToHost } from '../../lib/preview/replica-install.js';
import { wpOptionUpdatesForSiteMeta } from '../../lib/preview/site-options.js';
import { installPost } from '../../lib/streaming/post-install.js';
import { finalizeSite } from '../../lib/streaming/site-finalize.js';
import { startStaticServer } from '../../lib/replicate/local-site/static-server.js';
import { rewriteInternalLinksInJs } from '../../lib/replicate/local-site/href-rewrite.js';
import { captureScreenshots } from '../../lib/screenshot/screenshotter.js';
import { SCREENSHOT_DEVICE_SCALE_FACTOR } from '../../lib/screenshot/types.js';
import { compareScreenshotDirs } from '../../lib/screenshot/compare.js';
import { openEditorSession, scoreEditorSurface, type EditorSurfacePage } from '../../lib/preview/editor-preview.js';
import { ensureStudioSite, expandTilde, studioWpRoot } from '../../lib/preview/studio-site.js';
import { studioWp as studioWpExec } from '../../lib/preview/studio.js';
import { ensurePlugin } from '../../lib/preview/ensure-plugin.js';
import { connectBrowser } from '../../lib/browser-kit/index.js';
import type { DataModel } from '../../lib/replicate/local-data/types.js';
import { installLocalData } from '../../lib/replicate/local-data/data-install.js';
import { injectQueryLoops } from '../../lib/replicate/local-data/inject-query-loops.js';
import { buildQueryLoop } from '../../lib/replicate/local-data/query-loop.js';
import { neutralizeDataMounts } from '../../lib/replicate/local-data/neutralize-mounts.js';
import { rebindArrayLookups, DLA_ITEM_HELPER_JS } from '../../lib/replicate/local-data/modal-rebind.js';
import { validateDataModel } from '../../lib/replicate/local-data/validate-model.js';
import { mergeInstanceStyleCss } from '../../lib/replicate/normalize/instance-styles.js';
import { composedSidecarPath, instanceStylesPath } from '../../lib/streaming/block-markup-validate.js';
import type { PaletteAgg, TypographyAgg, BreakpointsAgg } from '../../lib/replicate/local-theme/foundation.js';
import { selfHostGoogleFonts } from '../../lib/replicate/local-theme/google-fonts.js';
import {
  collectSourceAssets,
  detectLayoutOffsetWrapper,
  extractGoogleFontCssUrls,
  extractSourceLandmarksFromHtml,
  landmarkRoleForHtmlRoot,
  reconcileRegions,
  rewriteHtmlImageSrcs,
  selectorForHtmlRoot,
  siteToTheme,
  WP_COMPAT_CSS,
  type AssetVerdicts,
  type FoundationTokens,
  type ImgAssetRef,
  type PlacedRegion,
  type RegionSelectionReport,
  type ThemeModel,
} from '@automattic/blocks-engine/theme';
import { buildJetpackFormParityCss } from '../../lib/replicate/local-site/jetpack-form-css.js';
import { JETPACK_FORM_PARITY_CSS } from '../../lib/replicate/local-theme/jetpack-form-parity-contract.js';
import { detectBehaviors } from '../../lib/replicate/normalize/detect-behaviors.js';
import { checkConservationLeaks } from '../../lib/replicate/normalize/conservation-check.js';
import { buildSelector, type SelectorParts } from '../../lib/replicate/section-selector.js';
import type { SourceLandmark } from '../../lib/replicate/section-extract.js';
import { buildInteractivityPlugin } from '../../blocks/interactivity-plugin.js';
import { buildEditableHtmlPlugin } from '../../blocks/editable-html-plugin.js';
import type { DetectedBehaviors, Section } from '../../lib/replicate/local-site/types.js';
import type { ConservationLeak } from '../../lib/replicate/normalize/conservation-leak.js';
import { safeFetch } from '../../lib/media-fetch/index.js';
import {
  buildDlaFunctionsPhpContent,
  buildDlaInteriorChromeTemplates,
  buildDlaThemeSupplementFiles,
  engineThemeResultToHostFiles,
  localThemeAuditSections,
  refineEngineThemeForDlaLocalPages,
  translateDlaFoundationToEngine,
  type EngineFoundationTranslation,
} from '../../lib/replicate/local-theme/engine-theme-adapter.js';
import {
  LOCAL_CONSERVATION_HARD_FAIL_ARG,
  LOCAL_CONSERVATION_HARD_FAIL_ROLES,
  LOCAL_CONSERVATION_RAIL_LINK_THRESHOLD,
  LOCAL_CONSERVATION_REPORT_SCHEMA,
  type LocalConservationRegionAudit,
  type LocalConservationSummary,
} from './convert-local-site-conservation-contract.js';
import { CLEAR_INTERVALS_SCRIPT, FREEZE_MOTION_CSS, probePair, type Divergence } from '../../lib/replicate/parity/parity-probe.js';
import { extractDiffRegions } from '../../lib/replicate/parity/diff-regions.js';
import { classifyDivergences, renderPatchCss, divergenceFingerprint, suppressPageConflicts, type UnresolvedDivergence, type PatchOverride, type RepairPlan } from '../../lib/replicate/parity/parity-classify.js';

/** Thin trimming wrapper over the shared Studio wp-cli exec — these are short
 * commands, so the 60s/10MB envelope rather than the 5min/50MB default. */
async function studioWp(sitePath: string, wpArgs: readonly string[]): Promise<string> {
  return (await studioWpExec(sitePath, [...wpArgs], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 })).trim();
}

async function dlaSafeFetch(input: Parameters<typeof fetch>[0] | URL, init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const headers = headersRecord(init?.headers ?? requestHeaders(input));
  const result = await safeFetch(fetchInputUrl(input), {
    ...(headers ? { headers } : {}),
  });
  return new Response(Uint8Array.from(result.body).buffer, {
    status: result.status,
    headers: result.headers,
  });
}

function fetchInputUrl(input: Parameters<typeof fetch>[0] | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function requestHeaders(input: Parameters<typeof fetch>[0] | URL): HeadersInit | undefined {
  if (typeof Request !== 'undefined' && input instanceof Request) return input.headers;
  return undefined;
}

function headersRecord(init: HeadersInit | undefined): Record<string, string> | undefined {
  if (!init) return undefined;
  const headers = new Headers(init);
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function writeAtomicTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

function normalizeRegionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function firstHtmlElement($: CheerioAPI): DomElement | null {
  const el = $('body').children().first().get(0) ?? $.root().children().first().get(0);
  return el && isTag(el) ? (el as DomElement) : null;
}

function isPlacedRegionRole(role: string | undefined): role is NonNullable<PlacedRegion['role']> {
  return role === 'header' || role === 'nav' || role === 'footer' || role === 'aside' || role === 'complementary';
}

function selectorPartsForElement($: CheerioAPI, el: DomElement): SelectorParts {
  const tag = el.tagName.toLowerCase();
  let nthOfType = 1;
  for (let prev = el.prev; prev; prev = prev.prev) {
    if (isTag(prev) && (prev as DomElement).tagName?.toLowerCase() === tag) nthOfType += 1;
  }
  const $el = $(el);
  return {
    tag,
    id: ($el.attr('id') ?? '').trim() || null,
    classes: ($el.attr('class') ?? '').split(/\s+/).filter(Boolean),
    nthOfType,
  };
}

function createSourceSelectorResolver(sourceHtml: string): (rootHtml: string) => string | undefined {
  const $source = cheerio.load(sourceHtml);
  const used = new Set<DomElement>();
  return (rootHtml: string): string | undefined => {
    const $fragment = cheerio.load(rootHtml);
    const root = $fragment('body').children().first().get(0) ?? $fragment.root().children().first().get(0);
    if (!root || !isTag(root)) return selectorForHtmlRoot(rootHtml);
    const rootHtmlCanonical = $fragment.html(root);
    const tag = (root as DomElement).tagName.toLowerCase();
    const candidates = $source(tag).toArray().filter((node): node is DomElement => isTag(node));
    for (const candidate of candidates) {
      if (used.has(candidate)) continue;
      if ($source.html(candidate) !== rootHtmlCanonical) continue;
      used.add(candidate);
      return buildSelector(selectorPartsForElement($source, candidate));
    }
    return selectorForHtmlRoot(rootHtml);
  };
}

function chromePlacedRegion(
  section: Section,
  kind: 'header_part' | 'footer_part',
  resolveSelector: (rootHtml: string) => string | undefined = selectorForHtmlRoot,
): PlacedRegion {
  const role = landmarkRoleForHtmlRoot(section.html);
  return {
    kind,
    selector: resolveSelector(section.html),
    ...(isPlacedRegionRole(role) ? { role } : {}),
  };
}

function bodyPlacedRegion(
  section: Section,
  resolveSelector: (rootHtml: string) => string | undefined = selectorForHtmlRoot,
): PlacedRegion {
  const role = landmarkRoleForHtmlRoot(section.html);
  return {
    kind: 'page_body_section',
    selector: resolveSelector(section.html),
    ...(isPlacedRegionRole(role) ? { role } : {}),
  };
}

function sourceIdsForHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const ids: string[] = [];
  const root = firstHtmlElement($);
  if (root) {
    const rootId = ($(root).attr('id') ?? '').trim();
    if (rootId) ids.push(rootId);
  }
  $('[id]').each((_, el) => {
    const id = ($(el).attr('id') ?? '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

function renderedPartContainsSourceSection(section: Section, renderedPart: string): boolean {
  if (!renderedPart.trim()) return false;
  const $source = cheerio.load(section.html);
  const root = firstHtmlElement($source);
  const scope = root ? $source(root) : $source('body');
  const rootClasses = root ? ($source(root).attr('class') ?? '').split(/\s+/).filter(Boolean) : [];
  const $rendered = cheerio.load(renderedPart);
  const renderedText = normalizeRegionText($rendered.text());
  const renderedIds = new Set<string>();
  $rendered('[id]').each((_, el) => {
    const id = ($rendered(el).attr('id') ?? '').trim();
    if (id) renderedIds.add(id);
  });
  const renderedClasses = new Set<string>();
  $rendered('[class]').each((_, el) => {
    for (const cls of ($rendered(el).attr('class') ?? '').split(/\s+/).filter(Boolean)) renderedClasses.add(cls);
  });

  const ids = sourceIdsForHtml(section.html);
  if (ids.some((id) => renderedIds.has(id) || renderedPart.includes(`"anchor":${JSON.stringify(id)}`))) return true;
  if (renderedPart.includes(`"anchor":${JSON.stringify(section.id)}`)) return true;
  if (rootClasses.some((cls) => renderedClasses.has(cls))) return true;
  if (ids.length > 0 || rootClasses.length > 0) return false;

  const linkLabels = $source('a[href]').toArray()
    .map((el) => normalizeRegionText($source(el).text()))
    .filter(Boolean);
  if (linkLabels.length > 0 && linkLabels.every((label) => renderedText.includes(label))) return true;

  const sourceText = normalizeRegionText(scope.text());
  return sourceText.length >= 24 && renderedText.includes(sourceText);
}

function localRenderedPlacedRegionsForLandmark(landmark: SourceLandmark, placed: PlacedRegion[]): PlacedRegion[] {
  const body = placed.filter((p) => p.kind === 'page_body_section');
  const chrome = placed.filter((p) => {
    if (p.kind === 'page_body_section') return false;
    if (p.selector === landmark.selector) return true;
    return p.selector === undefined && (p.role === undefined || p.role === landmark.role);
  });
  return [...body, ...chrome];
}

function reconcileLocalRenderedRegions(
  census: SourceLandmark[],
  placed: PlacedRegion[],
  page: string,
  entryUrl: string,
): RegionSelectionReport {
  const assignments = census.map((landmark) =>
    reconcileRegions(
      [landmark],
      localRenderedPlacedRegionsForLandmark(landmark, placed),
      page,
      entryUrl,
    ).assignments[0],
  );
  const sourceLandmarks: Record<string, number> = {};
  for (const landmark of census) sourceLandmarks[landmark.role] = (sourceLandmarks[landmark.role] ?? 0) + 1;
  const unassignedRegions = assignments.filter((a) => a.kind === 'unassigned').map((a) => a.landmark);
  return {
    page,
    entryUrl,
    assignments,
    unassignedRegions,
    counts: {
      sourceLandmarks,
      assigned: assignments.filter((a) => ['page_body_section', 'header_part', 'footer_part'].includes(a.kind)).length,
      unassigned: unassignedRegions.length,
      nonActionable: assignments.filter((a) => a.kind === 'non_actionable').length,
    },
  };
}

export const convertLocalSiteHandler: Handler = async (args, ctx) => {
  const dir = args.dir as string | undefined;
  const studioSitePathArg = args.studioSitePath as string | undefined;
  const outputDir = (args.outputDir as string | undefined) ?? dir;
  if (!dir) return ctx.errorResult('dir is required');
  if (!studioSitePathArg) return ctx.errorResult('studioSitePath is required');
  if (!outputDir) return ctx.errorResult('outputDir is required');

  // Belt-and-suspenders: normalize the Studio site path to a single absolute
  // path at the entry, so NO downstream code path (CLI `--path` args, the
  // `.dla-scripts` host writes that feed `wp eval-file`, the wp-root probe) can
  // ever see a bare `~`. `path.resolve` treats `~` as a literal segment, so an
  // un-expanded `~/Studio/x` scatters host files into a junk `<cwd>/~/Studio/x`
  // dir while `studio` itself DOES expand the tilde — the two disagree and every
  // eval-file install fails ("does not exist"). Expanding + resolving once here
  // closes that whole class of bug no matter which downstream step grows a new
  // path use. The skill documents `~/Studio/<slug>` as the canonical input.
  const studioSitePath = resolve(expandTilde(studioSitePathArg));

  const warnings: string[] = [];

  // createSite: provision the Studio target itself when absent, so this single
  // command drives everything (create site -> convert -> theme + live site) —
  // the local-static-site analog of the /liberate WP-target setup. Idempotent:
  // an existing site at studioSitePath is reused untouched. Admin creds come
  // from env (never the tool payload); omitted -> Studio auto-generates them.
  const createSite = args.createSite === true;
  let wpRoot = studioWpRoot(studioSitePath);
  if (!wpRoot && createSite) {
    const siteName =
      (args.siteTitle as string | undefined) ?? (basename(studioSitePath.replace(/\/+$/, '')) || 'Local Site');
    try {
      const provisioned = await ensureStudioSite({
        name: siteName,
        sitePath: studioSitePath,
        adminUser: process.env.WP_ADMIN_USER,
        adminPassword: process.env.WP_ADMIN_PASS,
      });
      wpRoot = provisioned.wpRoot;
      if (provisioned.created) warnings.push(`created Studio site "${siteName}" at ${studioSitePath}`);
    } catch (err) {
      return ctx.errorResult(`failed to create Studio site at ${studioSitePath}: ${(err as Error).message}`);
    }
  }
  if (!wpRoot) {
    return ctx.errorResult(
      `no wp-content found under ${studioSitePath} (or its wordpress/ subdir) — pass createSite:true to provision a fresh Studio site`,
    );
  }

  const skipDesign = args.skipDesign === true;
  const skipCompare = args.skipCompare === true;
  // BDC Task 5 editor-fidelity surface (MEASURE-ONLY, opt-in). Renders each
  // installed page's markup in the live block editor and scores the canvas vs
  // the source screenshot. Needs a logged-in editor: creds via env
  // (WP_ADMIN_PASS, optional WP_ADMIN_USER) — never args (no secrets in the
  // tool payload). Carry output is warn-only (the editor lacks the carried
  // source CSS), so it never flips the verdict here.
  const editorSurface = args.editorSurface === true;
  const repair = args.repair !== false;
  const maxRepairRounds = Math.min(Math.max(Number(args.maxRepairRounds ?? 2), 0), 5);
  const failOnConservationRailDrop = args[LOCAL_CONSERVATION_HARD_FAIL_ARG] === true;
  // Stage 1d: carry the source site's own CSS/JS into the theme so the class-
  // preserving block DOM renders under the designer's stylesheet. Default ON
  // (identical replication goal); pass carryCss:false / carryJs:false to opt out.
  const carryCss = args.carryCss !== false;
  // Replica base URL: explicit arg wins; otherwise auto-resolved AFTER theme
  // activation via `wp option get siteurl` (see below) — Studio assigns random
  // ports per site, so a hardcoded default would capture the WRONG site and
  // report silently bogus parity.
  let wpUrl = (args.wpUrl as string | undefined)?.replace(/\/$/, '');

  // nativeBehaviors replaces carried source JS with Interactivity blocks —
  // both at once would double-drive every behavior (double-init sliders,
  // re-animating reveals). Explicit carryJs:true is overridden, loudly.
  const nativeBehaviors = args.nativeBehaviors === true;
  // Default ON: core/html islands convert to in-canvas dla/editable-html (visible + styled
  // in the editor). Opt OUT with editableIslands:false to force plain core/html.
  const editableIslands = args.editableIslands !== false;
  if (nativeBehaviors && args.carryJs === true) {
    warnings.push('nativeBehaviors forces carryJs off (carried source JS would double-drive block behaviors)');
  }
  const carryJs = nativeBehaviors ? false : args.carryJs !== false;

  // WordPress-driven data path: when a data-model.json is present (authored by
  // the model-local-data skill), the source's JS-mounted card grids become a
  // real CPT + native query loops while the styling/animation/modal JS stays.
  // Gate is the file's presence; pass dataModel:false to force it off.
  let dataModel: DataModel | undefined;
  if (args.dataModel !== false) {
    for (const p of [join(outputDir, 'data-model.json'), join(dir, 'data-model.json')]) {
      if (!existsSync(p)) continue;
      try {
        const m = JSON.parse(readFileSync(p, 'utf8')) as DataModel;
        if (m && m.cpt?.slug && Array.isArray(m.mounts)) {
          // Validate the agent-authored model before it drives anything; on
          // errors, SKIP the data path (don't install a broken type or clobber
          // content) — warn-only, never aborts the conversion. (validator + report
          // adopted from wordpress-block-design-compiler's content-modeling.)
          const report = validateDataModel(m);
          try {
            const reportDir = join(outputDir, 'reports');
            mkdirSync(reportDir, { recursive: true });
            writeFileSync(join(reportDir, 'data-model-validation.json'), JSON.stringify(report, null, 2));
          } catch {
            /* report write is best-effort */
          }
          for (const w of report.warnings) warnings.push(`data-model warning: ${w}`);
          if (report.valid) {
            dataModel = m;
          } else {
            for (const e of report.errors) warnings.push(`data-model ERROR: ${e}`);
            warnings.push(`data-model.json invalid (${report.errors.length} error(s)) — data path skipped; see reports/data-model-validation.json`);
          }
        } else {
          warnings.push(`data-model.json at ${p} is missing cpt/mounts — ignored`);
        }
      } catch (err) {
        warnings.push(`data-model.json parse failed (${p}): ${(err as Error).message}`);
      }
      break;
    }
  }

  // Stage 1a: ingest + compose sidecars + normalize-report (reuse the handler
  // verbatim; nativeBehaviors makes it tag sidecar sections with dla/reveal).
  const cardMounts = dataModel?.mounts.filter((m) => m.sourceSelector) ?? [];
  const ingestRes = await ingestLocalSiteHandler({ dir, outputDir, nativeBehaviors, editableIslands, cardMounts }, ctx);
  if (ingestRes.isError) return ingestRes;
  // Forward stage-1a quality signals into the final summary, nested under one
  // `ingest` key so the two summaries' field shapes can't collide.
  const ingestSummary = JSON.parse(ingestRes.content[0].text) as {
    lowConfidence: number;
    failedPageCount: number;
    failedPagesList: Array<{ slug: string; error: string }>;
    formsConverted?: number;
    islandsConverted?: number;
    stylingDrops?: number;
    behaviors?: { reveal: boolean; tabs: number; slider: number; modal: number; gaps: number };
  };
  const formsConverted = ingestSummary.formsConverted ?? 0;
  const islandsConverted = ingestSummary.islandsConverted ?? 0;
  const ingest = {
    lowConfidence: ingestSummary.lowConfidence,
    failedPageCount: ingestSummary.failedPageCount,
    failedPagesList: ingestSummary.failedPagesList,
    // Styling-conservation: sections whose conversion dropped a source class
    // (detail in normalize-report.json). 0 = every source class survived.
    stylingDrops: ingestSummary.stylingDrops ?? 0,
  };
  // Per-kind section counts from the ingest summary — derived there from the
  // compose REPORTS (single source of truth; this handler never re-runs the
  // per-section detection). Fired kinds feed the residue claiming below so
  // their driver js stops inflating gaps.
  const kindCounts = {
    tabs: ingestSummary.behaviors?.tabs ?? 0,
    slider: ingestSummary.behaviors?.slider ?? 0,
    modal: ingestSummary.behaviors?.modal ?? 0,
  };
  const sectionKinds = new Set<'tabs' | 'slider' | 'modal'>();
  if (kindCounts.tabs > 0) sectionKinds.add('tabs');
  if (kindCounts.slider > 0) sectionKinds.add('slider');
  if (kindCounts.modal > 0) sectionKinds.add('modal');

  // Second ingest is deterministic + cheap (same dir, no writes between); the
  // handler call above already surfaced any slug-collision error.
  const site = ingestLocalSite(dir);
  const siteTitle = (args.siteTitle as string | undefined) ?? site.pages.find((p) => p.slug === 'home')?.title ?? 'Local Site';
  const themeSlug = (args.themeSlug as string | undefined) ?? 'local-site-theme';

  // Stage 1c — Design capture (unless skipDesign): serve the local site over
  // HTTP, run the screenshot pipeline to collect palette/typography/breakpoints
  // aggregates, build a deterministic design foundation, and self-host any
  // Google Fonts found in the source HTML/CSS. Failures here degrade to a
  // warning and fall back to the default foundation — never abort.
  let foundationTranslation: EngineFoundationTranslation | undefined;
  let localizedFontCss = '';
  let designCaptured = false;
  const sourceCaptureDir = join(outputDir, 'source');

  // Deterministic parity captures: the source's reveal animations (html.js
  // opacity/translate transitions) race the screenshot on BOTH sides, jittering
  // pixelmatch scores run-to-run. Freeze all animation and force the revealed
  // end-state symmetrically — the comparison measures design, not motion timing.
  // Shared with the parity probe so probe-state == capture-state.
  const freezeMotion = async (page: import('playwright').Page): Promise<void> => {
    await page.addStyleTag({ content: FREEZE_MOTION_CSS });
    // Kill JS autoplay/tickers identically on BOTH sides: css freezing cannot
    // reach setInterval class-movers, and source/replica timers start at their
    // own load instants — a settle crossing the interval boundary on one side
    // flips the active slide (slider autoplay). Behavior verification lives in
    // the behavior probe, which asserts autoplay on live pages WITHOUT the
    // freeze. String-form evaluate (tsx __name gotcha).
    await page.evaluate(CLEAR_INTERVALS_SCRIPT);
  };

  if (!skipDesign) {
    let server: Awaited<ReturnType<typeof startStaticServer>> | undefined;
    try {
      server = await startStaticServer(dir);
      // Use relPath-based URLs so nested pages resolve: slug-based pageUrl('blog-post')
      // would 404 on a source that has blog/post.html (Task-1 review C1).
      const sourceUrls = site.pages.map((p) => server!.urlForPage(p.relPath));
      await captureScreenshots({
        urls: sourceUrls,
        outputDir: sourceCaptureDir,
        primaryUrl: server.url,
        captureDesign: true,
        concurrency: 6, // worker-pool capture (screenshotter drains a shared cursor)
        prepareCapture: freezeMotion,
      });
      const readJson = <T>(name: string): T =>
        JSON.parse(readFileSync(join(sourceCaptureDir, name), 'utf8')) as T;
      // Source CSS/HTML text serves two consumers: hex-literal accent
      // candidates for the foundation (the aggregator samples CONTAINER
      // backgrounds only, so an accent living on a.button never reaches
      // palette.json — but we own the authored CSS) and Google-Fonts css2
      // link discovery below.
      const cssSources = site.pages.map((p) => p.html);
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.css')) cssSources.push(readFileSync(join(dir, f), 'utf8'));
      }
      foundationTranslation = translateDlaFoundationToEngine({
        palette: readJson<PaletteAgg>('palette.json'),
        typography: readJson<TypographyAgg>('typography.json'),
        breakpoints: readJson<BreakpointsAgg>('breakpoints.json'),
        cssSources,
      });

      const fontCssUrls = extractGoogleFontCssUrls(cssSources);
      if (fontCssUrls.length > 0) {
        const hosted = await selfHostGoogleFonts(fontCssUrls, { themeDir: join(outputDir, 'theme') });
        // Verbatim Google css (all unicode-range subsets, URLs localized) —
        // spliced into the carried stylesheet so glyph metrics match the
        // source exactly (the old one-file-per-weight collapse measurably
        // narrowed Fraunces/Work Sans and shifted every wrap point).
        localizedFontCss = hosted.localizedCss;
        for (const e of hosted.errors) warnings.push(`font self-host failed: ${e.url}: ${e.error}`);
      }

      designCaptured = true;
    } catch (err) {
      warnings.push(`design capture failed (default styling used): ${(err as Error).message}`);
    } finally {
      await server?.close();
    }
  }

  // Stage 1d: collect source CSS/JS from disk (link-driven, document order).
  // Runs regardless of skipDesign — assets live on disk, no Playwright needed.
  // When both flags are off, carrySourceAssets stays undefined (tokens-only theme).
  // nativeBehaviors also needs the collected assets (detection input) even when
  // nothing is carried, without turning carrySourceAssets into a defined-but-
  // empty object (that would change theme assembly).
  let carrySourceAssets: { css: string; js: string } | undefined;
  let behaviors: DetectedBehaviors | undefined;
  // Carried HTML <img> assets (content images) — repointed at the theme copies
  // in the install loop; any SVG among them arms the safe-svg install below.
  let imgRewritesByPage: Record<string, ImgAssetRef[]> = {};
  let carriedImgCount = 0;
  let svgCarried = false;
  if (carryCss || carryJs || nativeBehaviors) {
    const assets = collectSourceAssets(dir, site.pages.map((p) => ({ relPath: p.relPath, html: p.html })));
    if (assets.skippedUnlinked.length > 0) {
      warnings.push(
        `unlinked top-level assets skipped (linked assets exist; stale-revision protection): ${assets.skippedUnlinked.join(', ')}`,
      );
    }
    // Carry HTML <img> assets (content images: svg/png/jpg…) into the theme so
    // the rewritten <img src> theme URLs resolve. Independent of carryCss — these
    // are content, not design. Best-effort: a copy failure degrades to a warning.
    imgRewritesByPage = assets.imgRewritesByPage;
    for (const m of assets.imgAssets) {
      try {
        const dest = join(outputDir, 'theme', m.themeRel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(m.srcAbs, dest);
        carriedImgCount++;
        if (/\.svg$/i.test(m.themeRel)) svgCarried = true;
      } catch (err) {
        warnings.push(`carry img ${m.themeRel}: ${(err as Error).message}`);
      }
    }
    if (carryCss || carryJs) {
      // Splice the localized Google-font css (verbatim subsets, local URLs)
      // right after the compat layer — same cascade position the stripped
      // @import occupied, so font resolution matches the source byte-for-byte.
      const cssWithFonts = localizedFontCss
        ? assets.css.replace(WP_COMPAT_CSS, WP_COMPAT_CSS + localizedFontCss + '\n\n')
        : assets.css;
      // The carried JS is OURS to adapt at build time: internal page refs
      // in quoted literals ({ href:'shop.html' } nav arrays) become /slug/
      // permalinks ONCE, in the bundle — this is a WordPress site now.
      let carriedJs = carryJs ? rewriteInternalLinksInJs(assets.js, site.pages) : '';
      // WordPress-driven data: the grids are now server-rendered query loops, so
      // drop the JS data-mount calls and rebind the source array lookups (the
      // modal) onto the per-card DOM data islands; keep everything else.
      if (carriedJs && dataModel) {
        const neutralized = neutralizeDataMounts(carriedJs, dataModel.mounts.map((m) => m.selector));
        const rebound = rebindArrayLookups(neutralized.js, dataModel.sourceArrays ?? []);
        carriedJs = `${rebound.js}\n${DLA_ITEM_HELPER_JS}\n`;
        warnings.push(
          `data: neutralized ${neutralized.removed} mount call(s), rebound ${rebound.rewritten} lookup(s)`,
        );
      }
      carrySourceAssets = {
        css: carryCss ? cssWithFonts : '',
        js: carriedJs,
      };
      // Carry the CSS-referenced images (background url()s the carried css now
      // points at as media/<name>) into the on-disk theme dir so assetSourceDir
      // copies them into the live theme — without them the rewritten url()s 404
      // and bg-image placeholders render empty (maison scent hero). Best-effort:
      // a copy failure degrades to a warning, never aborts the conversion.
      if (carryCss) {
        for (const m of assets.mediaAssets) {
          try {
            const dest = join(outputDir, 'theme', m.themeRel);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(m.srcAbs, dest);
          } catch (err) {
            warnings.push(`carry media ${m.themeRel}: ${(err as Error).message}`);
          }
        }
      }
    }
    // Detection runs on the RAW collected strings — assets.css includes the
    // prepended WP_COMPAT_CSS, which is detection-immune (no html.js section
    // gate, no scroll-listener patterns; reviewer-verified). Mirrors the
    // ingest handler's FINAL detection pass exactly (same pure fn, same
    // inputs, same sectionKinds — derived from the ingest summary above,
    // which exists before this runs), so the two stages cannot disagree and
    // the fired kinds' driver js is claimed out of the gap report here too.
    behaviors = nativeBehaviors
      ? detectBehaviors({ css: assets.css, js: assets.js }, { sectionKinds })
      : undefined;
  }

  // Behavior gaps artifact: every uncatalogued source-JS pattern, reported
  // (never guessed). Atomic tmp+rename like the sibling reports.
  if (behaviors) {
    const gapsPath = join(outputDir, 'behavior-gaps.json');
    const gapsTmp = `${gapsPath}.tmp.${process.pid}`;
    try {
      writeFileSync(gapsTmp, JSON.stringify({ schema: 1, site: dir, gaps: behaviors.gaps }, null, 2) + '\n');
      renameSync(gapsTmp, gapsPath);
    } catch (err) {
      try { unlinkSync(gapsTmp); } catch { /* ignore */ }
      warnings.push(`behavior-gaps write failed: ${(err as Error).message}`);
    }
  }
  // Truthful carry flags, hoisted above the chrome build: mount detection
  // needs to know whether source JS is actually carried (an empty mount with
  // no JS to fill it = blank chrome).
  const carriedCss = carryCss && (carrySourceAssets?.css ?? '').trim().length > 0;
  const carriedJs = carryJs && (carrySourceAssets?.js ?? '').trim().length > 0;
  let jetpackFormParityCss: string | undefined;
  if (formsConverted >= 1) {
    const built = buildJetpackFormParityCss({
      sourceCss: carrySourceAssets?.css ?? '',
      formsConverted,
    });
    const css = built.css.trim();
    if (css.length > 0) jetpackFormParityCss = css;
  }

  const home = site.pages.find((p) => p.slug === 'home') ?? site.pages[0];
  const stickyEmitted = !!behaviors?.sticky && carriedCss;
  if (behaviors?.sticky && !stickyEmitted) {
    warnings.push('sticky behavior detected but not emitted (requires carried chrome header)');
  }
  const interiorChromeBySlug = buildDlaInteriorChromeTemplates(site, home.slug);

  // Merge the page-body lib-i rules (written by ingest to composed/
  // instance-styles.css) with the chrome rules just collected. Only when CSS is
  // carried — the rules refine the carried source stylesheet. Empty → undefined
  // (no asset, no enqueue).
  // Query-loop li-flatten rules so the carried grid CSS + client-side filter
  // keep binding to .obj-card through the post-template <li> wrappers. Depends
  // only on the mount ids, so it's computed independent of injection.
  const dataCss = dataModel
    ? dataModel.mounts
        .map((m) => buildQueryLoop(m).css)
        .filter(Boolean)
        .join('\n')
    : '';
  let instanceStylesCss: string | undefined;
  {
    const chunks: string[] = [];
    if (carriedCss) {
      let bodyInstanceCss = '';
      try {
        bodyInstanceCss = readFileSync(instanceStylesPath(outputDir), 'utf8');
      } catch {
        /* no body instance styles (none carried) */
      }
      chunks.push(bodyInstanceCss);
    }
    if (dataCss) chunks.push(dataCss);
    const merged = mergeInstanceStyleCss(...chunks);
    instanceStylesCss = merged.length > 0 ? merged : undefined;
  }

  // Theme assembly + write + activate.
  // In carry mode the localized Google css inside source.css is the SOLE font
  // authority — passing capturedFonts too makes the scaffold's style.css emit
  // range-less duplicate faces pointing at single subset files; Chromium then
  // resolves ch against a face whose '0' glyph is absent (spec fallback 0.5em),
  // shrinking every ch-based max-width (walrus: 62ch = 527px vs 655px) while
  // text still shapes correctly via the next face. One authority, no overlap.
  // Source <main> class → carried onto post-content so body-layout rules that
  // key off it survive — notably an inter-section blockGap (a
  // `.<main-class> > * + * { margin-top }` rule). Without it the page sections
  // butt together (vertical rhythm collapses). Usually consistent across pages;
  // first match wins.
  const mainClass = (() => {
    for (const p of [home, ...site.pages]) {
      const m = p?.html?.match(/<main\b[^>]*\bclass="([^"]+)"/i);
      if (m) return m[1];
    }
    return undefined;
  })();
  const mainWrapperClass = detectLayoutOffsetWrapper(home.html, carrySourceAssets?.css ?? '');
  const bodyDataByPath = Object.fromEntries(
    site.pages
      .filter((p) => p.bodyData)
      .map((p) => [p.slug === home.slug ? '/' : `/${p.slug}/`, p.bodyData!]),
  );
  const interiorChromeTemplates = [...interiorChromeBySlug.values()];
  let engineResult: Awaited<ReturnType<typeof siteToTheme>>;
  let headerPart = '';
  let footerPart = '';
  try {
    engineResult = await siteToTheme(dir, {
      outDir: join(outputDir, 'theme'),
      themeMeta: { slug: themeSlug, name: siteTitle },
      ...(foundationTranslation ? { foundationAggregates: foundationTranslation.foundationAggregates } : {}),
      fetchImpl: dlaSafeFetch,
      coverageFloor: 0,
      carrySourceCss: false,
      // Local-convert installs page bodies from DLA ingest; engine page-markup
      // hoisting would emit orphaned lib-*.json block styles. This is
      // intentional and correct, not a band-aid: local emit-blocks already
      // dedupes element-layer instance styles as lib-i, so engine variation
      // hoist would be a redundant second dedup whose output is orphaned.
      variationHoist: false,
      hooks: {
        onFoundation: async (tokens: FoundationTokens): Promise<FoundationTokens> =>
          foundationTranslation?.tokens ?? tokens,
        onSection: async (section) => section,
        onAssets: async (inventory): Promise<AssetVerdicts> => ({
          keep: inventory.assets.map((asset) => asset.relPath),
          decoration: [],
        }),
        onRefine: async (theme: ThemeModel): Promise<ThemeModel> =>
          refineEngineThemeForDlaLocalPages(theme, {
            site,
            siteTitle,
            themeSlug,
            mainClass,
            mainWrapperClass,
            interiorChromeTemplates,
            carrySourceAssets,
            instanceStylesCss,
            jetpackFormParityCss,
            allowSourceChromeMounts: carriedCss && carriedJs,
            ...(stickyEmitted ? { sticky: behaviors!.sticky } : {}),
          }),
      },
    });
    headerPart = engineResult.model.parts['header.html'] ?? '';
    footerPart = engineResult.model.parts['footer.html'] ?? '';
    for (const warning of engineResult.warnings) warnings.push(warning);
  } catch (err) {
    return ctx.errorResult(`theme build failed: ${(err as Error).message}`);
  }
  // (carriedCss/carriedJs are hoisted above the chrome build — they also gate
  // the repair loop + summary below.)

  let themeWritten = 0;
  let pluginSlugs: string[] = [];
  try {
    // assetSourceDir carries downloaded fonts (woff2) into the live theme so the
    // install is self-contained without a separate binary-copy step.
    // nativeBehaviors ships the static dla-interactivity block plugin alongside
    // the theme. editorScript is build-less (global wp packages) and preserves
    // saved source HTML; frontend behavior still rides viewScriptModule.
    // Accepted residue: a later CARRY re-convert leaves the plugin active with
    // zero dla/* blocks on any page — viewScriptModule enqueues per-render
    // only (no module loads, no behavior), but the registered block style
    // ships ~400B of inert reveal CSS globally under WP's default block-asset
    // loading (every selector requires the absent dla-reveal-js gate; zero
    // visual effect). Accepted over auto-deactivation.
    const blockPlugins = [
      ...(nativeBehaviors ? [buildInteractivityPlugin()] : []),
      ...(editableIslands && islandsConverted > 0 ? [buildEditableHtmlPlugin()] : []),
    ];
    const functionsPhp = buildDlaFunctionsPhpContent({
      siteTitle,
      themeSlug,
      carrySourceAssets,
      instanceStylesCss,
      jetpackFormParityCss,
      bodyDataByPath,
    });
    const extraThemeFiles = buildDlaThemeSupplementFiles({
      siteTitle,
      themeSlug,
      mainClass,
      mainWrapperClass,
      interiorChromeTemplates,
      carrySourceAssets,
      instanceStylesCss,
      jetpackFormParityCss,
    });
    writeAtomicTextFile(join(engineResult.outDir, 'functions.php'), functionsPhp);
    const hostFiles = engineThemeResultToHostFiles(engineResult, { functionsPhp, extraThemeFiles });
    const written = writeReplicaFilesToHost({
      wpRoot,
      themeSlug,
      themeFiles: hostFiles.themeFiles,
      assetSourceDir: hostFiles.assetSourceDir,
      ...(blockPlugins.length > 0 ? { blockPlugins } : {}),
    });
    themeWritten = written.themeWritten;
    pluginSlugs = written.pluginSlugs;
  } catch (err) {
    return ctx.errorResult(`theme write failed: ${(err as Error).message}`);
  }
  if (jetpackFormParityCss) {
    try {
      writeAtomicTextFile(join(outputDir, JETPACK_FORM_PARITY_CSS.outputFileName), jetpackFormParityCss + '\n');
    } catch (err) {
      warnings.push(`jetpack form parity css mirror write failed: ${(err as Error).message}`);
    }
  }
  // Stale carry assets from a PRIOR convert: writeReplicaFilesToHost never
  // deletes — it only writes this run's files — and functions.php's enqueue
  // guard makes any leftover ACTIVE. Under nativeBehaviors a stale source.js
  // re-armed the OLD source JS alongside the Interactivity blocks (E2E:
  // double drivers, gap behaviors leaked back). Deleting the file the current
  // run did NOT carry is the designed off-switch.
  {
    const liveThemeRoot = join(wpRoot, 'wp-content', 'themes', themeSlug);
    try {
      if (!carriedJs) {
        const staleJs = join(liveThemeRoot, 'assets', 'js', 'source.js');
        if (existsSync(staleJs)) unlinkSync(staleJs);
      }
      if (!carriedCss) {
        const staleCss = join(liveThemeRoot, 'assets', 'css', 'source.css');
        if (existsSync(staleCss)) unlinkSync(staleCss);
      }
    } catch (err) {
      warnings.push(`stale carry asset cleanup failed: ${(err as Error).message}`);
    }
  }
  try {
    await studioWp(studioSitePath, ['theme', 'activate', themeSlug]);
  } catch (err) {
    warnings.push(`theme activate failed: ${(err as Error).message}`);
  }
  if (shouldInstallJetpackFormsPlugin(formsConverted)) {
    try {
      await studioWp(studioSitePath, JETPACK_FORMS_PLUGIN_INSTALL.wpArgs);
      try {
        await studioWp(studioSitePath, JETPACK_FORMS_MODULE_ACTIVATE.wpArgs);
      } catch (err) {
        warnings.push(jetpackFormsModuleActivateWarning(err as Error));
      }
    } catch (err) {
      warnings.push(jetpackFormsPluginInstallWarning(err as Error));
    }
  }
  // The custom dla/* blocks must be registered before page render/editor open.
  // Mirrors the theme-activate degrade-to-warning contract.
  for (const slug of pluginSlugs) {
    try {
      await studioWp(studioSitePath, ['plugin', 'activate', slug]);
    } catch (err) {
      warnings.push(`plugin activate failed for ${slug}: ${(err as Error).message}`);
    }
  }
  // SVGs ride into the theme as static assets (they render without a plugin),
  // but install safe-svg whenever SVGs are present so the user can UPLOAD/replace
  // them via the media library + block editor — the any-liberate-path "SVGs
  // detected → safe-svg" rule (parity with the remote media-install path).
  // Best-effort; a failure never aborts the conversion.
  let safeSvgEnsured = false;
  if (svgCarried) {
    const ensured = await ensurePlugin(studioSitePath, 'safe-svg', studioWp);
    if (ensured.ok) safeSvgEnsured = true;
    else warnings.push(`safe-svg install failed: ${ensured.error}`);
  }
  if (carriedImgCount > 0) {
    warnings.push(
      `carried ${carriedImgCount} HTML <img> asset(s) into the theme` +
        (svgCarried ? ` (safe-svg ${safeSvgEnsured ? 'ensured' : 'NOT installed'})` : ''),
    );
  }
  // Resolve the replica base URL now that the site is known reachable
  // (activation just ran against it). Failure degrades to the conventional
  // wp-env default with a warning — never aborts.
  if (!wpUrl) {
    try {
      wpUrl = (await studioWp(studioSitePath, ['option', 'get', 'siteurl'])).trim().replace(/\/$/, '');
    } catch (err) {
      wpUrl = 'http://localhost:8889';
      warnings.push(`siteurl resolve failed, using ${wpUrl}: ${(err as Error).message}`);
    }
  }
  // Flush caches so the freshly-written templates + customTemplates register
  // immediately (install-theme.ts precedent: block themes cache template
  // resolution and the patterns file list; without a flush the just-activated
  // theme can serve stale/empty versions). Best-effort — warn, never fatal.
  for (const wpArgs of themeCacheFlushCommands()) {
    try {
      await studioWp(studioSitePath, wpArgs);
    } catch (err) {
      warnings.push(`cache flush failed (${wpArgs.slice(0, 2).join(' ')}): ${(err as Error).message}`);
    }
  }
  // WordPress-driven data: write the CPT + data-card mu-plugins and insert the
  // taxonomy terms + content items (idempotent by _dla_item_id) BEFORE pages so
  // the query loops have posts to render. Failures are non-fatal (the page still
  // installs; the loop just renders empty).
  if (dataModel) {
    try {
      const di = await installLocalData({ model: dataModel, studioSitePath, wpRoot, sourceDir: dir });
      const guards =
        (di.skippedModified ? `, ${di.skippedModified} skipped (edited in wp-admin)` : '') +
        (di.collisions ? `, ${di.collisions} slug-collision(s)` : '') +
        (di.defaultsTrashed ? `, ${di.defaultsTrashed} WP seed default(s) trashed` : '');
      for (const mediaError of di.mediaErrors) {
        warnings.push(`data media: ${mediaError.sourceUrl}: ${mediaError.error}`);
      }
      warnings.push(
        `data: ${di.inserted} inserted, ${di.updated} updated, ${di.terms} term(s), ${di.mediaInstalled} media item(s) installed${guards}; mu-plugins ${di.muPlugins.join(', ')}`,
      );
    } catch (err) {
      warnings.push(`data install failed: ${(err as Error).message}`);
    }
  }

  // Pages from sidecars (installPost is idempotent via _source_url meta).
  const plan = buildPagePlan(site, outputDir);
  const emptySidecars = plan.items.filter((i) => !i.content.trim()).map((i) => i.slug);
  const conservationLeaks: ConservationLeak[] = [];
  for (const item of plan.items) {
    const page = site.pages.find((p) => p.slug === item.slug);
    if (!page) continue;
    const interiorChrome = interiorChromeBySlug.get(item.slug);
    conservationLeaks.push(
      ...checkConservationLeaks({
        pageSlug: item.slug,
        sourceHtml: page.html,
        postContent: item.content,
        partMarkup: [headerPart, footerPart, ...(interiorChrome ? [interiorChrome.partMarkup] : [])],
      }),
    );
  }
  const conservationReportPath = join(outputDir, 'conservation-leaks.json');
  try {
    writeAtomicTextFile(
      conservationReportPath,
      JSON.stringify({ schema: 1, site: dir, leaks: conservationLeaks }, null, 2) + '\n',
    );
  } catch (err) {
    warnings.push(`conservation leaks report write failed: ${(err as Error).message}`);
  }
  const localRegionReportPath = join(outputDir, 'region-audit.json');
  const safeConservationSummary = (): LocalConservationSummary => ({
    ok: true,
    status: 'pass',
    unassignedRegions: 0,
    hardFailRegions: 0,
    artifact: localRegionReportPath,
    railHardFail: {
      enabled: failOnConservationRailDrop,
      roles: LOCAL_CONSERVATION_HARD_FAIL_ROLES,
      minLinks: LOCAL_CONSERVATION_RAIL_LINK_THRESHOLD,
    },
  });
  let conservation = safeConservationSummary();
  try {
    const resolveHomeSelector = createSourceSelectorResolver(home.html);
    const localCensus = extractSourceLandmarksFromHtml(home.html);
    const homeSections = localThemeAuditSections(home.html);
    const headerSection =
      homeSections.find((s) => s.role === 'header') ?? homeSections.find((s) => s.role === 'nav') ?? null;
    const footerSection = homeSections.find((s) => s.role === 'footer') ?? null;
    const localPlacedRegions: PlacedRegion[] = [
      ...homeSections
        .filter((s) => s.role === 'body' && s.chromeSource !== 'layout-rail')
        .map((s) => bodyPlacedRegion(s, resolveHomeSelector)),
    ];
    if (
      headerSection &&
      headerSection.chromeSource !== 'layout-rail' &&
      renderedPartContainsSourceSection(headerSection, headerPart)
    ) {
      localPlacedRegions.push(chromePlacedRegion(headerSection, 'header_part', resolveHomeSelector));
    }
    if (footerSection && renderedPartContainsSourceSection(footerSection, footerPart)) {
      localPlacedRegions.push(chromePlacedRegion(footerSection, 'footer_part', resolveHomeSelector));
    }
    for (const rail of homeSections.filter((s) => s.chromeSource === 'layout-rail')) {
      if (renderedPartContainsSourceSection(rail, headerPart)) {
        localPlacedRegions.push(chromePlacedRegion(rail, 'header_part', resolveHomeSelector));
      }
    }
    const localRegionReport = reconcileLocalRenderedRegions(localCensus, localPlacedRegions, home.slug, home.relPath);
    const candidateHardFailRegions = localRegionReport.unassignedRegions.filter(
      (region) =>
        (LOCAL_CONSERVATION_HARD_FAIL_ROLES as readonly string[]).includes(region.role) &&
        (region.linkCount ?? 0) >= LOCAL_CONSERVATION_RAIL_LINK_THRESHOLD,
    );
    const hardFailRegions = failOnConservationRailDrop ? candidateHardFailRegions : [];
    conservation = {
      ok: hardFailRegions.length === 0,
      status: hardFailRegions.length > 0 ? 'fail' : localRegionReport.counts.unassigned > 0 ? 'warn' : 'pass',
      unassignedRegions: localRegionReport.counts.unassigned,
      hardFailRegions: hardFailRegions.length,
      artifact: localRegionReportPath,
      railHardFail: {
        enabled: failOnConservationRailDrop,
        roles: LOCAL_CONSERVATION_HARD_FAIL_ROLES,
        minLinks: LOCAL_CONSERVATION_RAIL_LINK_THRESHOLD,
      },
    };
    try {
      const regionAudit: LocalConservationRegionAudit = {
        schema: LOCAL_CONSERVATION_REPORT_SCHEMA,
        site: dir,
        pages: [localRegionReport],
        unassignedRegions: localRegionReport.counts.unassigned,
        hardFailRegions,
      };
      writeAtomicTextFile(localRegionReportPath, JSON.stringify(regionAudit, null, 2) + '\n');
    } catch (err) {
      warnings.push(`region audit write failed: ${(err as Error).message}`);
    }
  } catch (err) {
    warnings.push(`region audit failed: ${(err as Error).message}`);
    conservation = safeConservationSummary();
  }
  const installed: Array<{ slug: string; postId: number | null }> = [];
  const failedInstalls: Array<{ slug: string; error: string }> = [];
  for (const item of plan.items) {
    try {
      // Splice query loops into the page where empty JS-mounts were.
      let contentOverride: string | undefined;
      if (dataModel) {
        const inj = injectQueryLoops(item.content, dataModel.mounts);
        if (inj.injected.length > 0) {
          contentOverride = inj.markup;
          warnings.push(`data: ${item.slug} → query loop(s) for ${inj.injected.join(', ')}`);
        }
      }
      // Repoint carried <img src> at the theme-carried asset copies (else the
      // source-relative paths 404 against the WP page permalink).
      const imgPage = site.pages.find((p) => p.slug === item.slug);
      const imgRefs = imgPage ? imgRewritesByPage[imgPage.relPath] : undefined;
      if (imgRefs && imgRefs.length > 0) {
        contentOverride = rewriteHtmlImageSrcs(contentOverride ?? item.content, imgRefs, themeSlug);
      }
      const res = await installPost({ item, outputDir, studioSitePath, contentOverride });
      if (!res || res.action === 'error') {
        failedInstalls.push({ slug: item.slug, error: res?.error ?? 'unsupported item' });
      } else {
        installed.push({ slug: item.slug, postId: res.postId });
      }
    } catch (err) {
      failedInstalls.push({ slug: item.slug, error: (err as Error).message });
    }
  }

  // Site finalize — blogname option, per-page _wp_page_template assigns, and
  // the front-page pair — consolidated into ONE `wp eval-file` round-trip
  // (site-finalize.ts). Studio's IPC layer flakes on bursts of individual
  // argv `studio wp` commands ("No activity for 120s") while eval-file calls
  // (the installPost shape: one IPC slot, values via JSON file) succeed
  // reliably. On a fresh site a dropped blogname (site-title block renders
  // the wrong brand) or template assign (wrong template) is a STRUCTURAL
  // parity failure the repair loop cannot fix — these writes ride the
  // reliable channel. studioWp stays for activate + cache-flush (constant-arg
  // calls that never flaked).
  // Runs AFTER theme activation (the page-local customTemplate must be
  // registered before _wp_page_template assignment resolves) and AFTER the
  // installPost loop (it needs the postIds).
  let frontPageSet = false;
  {
    // The header's core/site-title renders the blogname option — without this
    // the converted site shows the Studio default name, not the ingested title.
    // wpOptionUpdatesForSiteMeta normalizes + skips empty titles (no tagline
    // source in the local-site path, so this emits exactly the blogname update).
    const finalizeOptions: Record<string, string> = {};
    for (const [option, value] of wpOptionUpdatesForSiteMeta({ title: siteTitle })) {
      finalizeOptions[option] = value;
    }
    const templateAssigns = installed
      .filter((p) => p.postId != null)
      .map((p) => ({
        postId: p.postId as number,
        slug: p.slug,
        template: interiorChromeBySlug.get(p.slug)?.templateName ?? 'page-local',
      }));
    const homeInstall = installed.find((p) => p.slug === plan.homeSlug);
    const frontPageId = homeInstall?.postId != null ? homeInstall.postId : undefined;
    try {
      const finalize = await finalizeSite({
        payload: {
          options: finalizeOptions,
          templateAssigns,
          ...(frontPageId !== undefined ? { frontPageId } : {}),
        },
        studioSitePath,
      });
      frontPageSet = finalize.applied.frontPage;
      // Per-item failures map to the SAME warning prefixes the old per-command
      // path emitted, so existing log greps and tests keep working.
      for (const e of finalize.errors) {
        if (e.item.startsWith('option:')) {
          warnings.push(`${e.item.slice('option:'.length)} set failed: ${e.error}`);
        } else if (e.item.startsWith('template:')) {
          warnings.push(`template assign failed for ${e.item.slice('template:'.length)}: ${e.error}`);
        } else if (e.item === 'frontPage') {
          warnings.push(`front page set failed: ${e.error}`);
        } else {
          warnings.push(`site finalize ${e.item} failed: ${e.error}`);
        }
      }
    } catch (err) {
      // Whole-call failure (exec/timeout/garbage stdout): one warning listing
      // everything that was attempted; frontPageSet stays false.
      const attempted = [
        ...Object.keys(finalizeOptions).map((o) => `option ${o}`),
        ...templateAssigns.map((t) => `template ${t.slug}`),
        ...(frontPageId !== undefined ? ['front page'] : []),
      ];
      warnings.push(`site finalize failed (attempted: ${attempted.join(', ')}): ${(err as Error).message}`);
    }
  }

  // Stage 1c — Compare: capture the WP replica and score parity against the
  // source screenshots. Skipped when skipDesign or skipCompare, or when design
  // capture failed (no source screenshots to compare against).
  // KNOWN LIMITATION (flat sites unaffected): nested pages compare-join by
  // pathname will miss — source serves /blog/post/ (relPath) while the WP
  // permalink is /blog-post/ (joined slug). Real fix = create WP pages with
  // parent hierarchy mirroring relPath (later stage). Nested pages appear in
  // source capture but produce missing-replica rows in the comparison output —
  // visible, not silent.
  const PARITY_FLOOR = 0.99;
  // Hoisted so the repair loop can re-capture and re-compare without recomputing.
  const replicaCaptureDir = join(outputDir, 'replica');
  const replicaUrls = installed
    .filter((p) => p.postId != null)
    .map((p) => (p.slug === plan.homeSlug ? `${wpUrl}/` : `${wpUrl}/${p.slug}/`));
  let parity:
    | {
        floor: number;
        allPass: boolean;
        avgDesktop: number;
        avgMobile: number;
        pages: Array<{
          pathname: string;
          desktop: number | null;
          mobile: number | null;
          desktopHeightPass?: boolean;
          mobileHeightPass?: boolean;
          passes: boolean;
        }>;
        repair?: { rounds: number; overrides: number; unresolved: UnresolvedDivergence[]; converged: boolean; heightOnly?: string[] };
      }
    | undefined;
  if (!skipDesign && !skipCompare && designCaptured) {
    try {
      await captureScreenshots({
        urls: replicaUrls,
        outputDir: replicaCaptureDir,
        primaryUrl: wpUrl,
        concurrency: 6, // worker-pool capture (screenshotter drains a shared cursor)
        prepareCapture: freezeMotion,
      });
      const comparison = await compareScreenshotDirs({
        originDir: join(sourceCaptureDir, 'screenshots'),
        replicaDir: join(replicaCaptureDir, 'screenshots'),
      });
      const scores = (v: 'desktop' | 'mobile'): number[] =>
        comparison.results.map((r) => r[v]?.score).filter((s): s is number => typeof s === 'number');
      const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      const parityPages = comparison.results.map((r) => {
        const d = r.desktop?.score ?? null;
        const m = r.mobile?.score ?? null;
        return {
          pathname: r.pathname,
          desktop: d,
          mobile: m,
          // heightPass carried per viewport so the repair loop can tell a
          // height-only failure (no diff pixels inside the cropped diff —
          // nothing probeable) apart from a pixel failure it can patch.
          desktopHeightPass: r.desktop?.heightPass,
          mobileHeightPass: r.mobile?.heightPass,
          // Height gate folds INTO passes (`!== false` keeps older
          // comparison.json / mocks without the field passing — production
          // scoring always sets it on ok viewports). Height-only failures are
          // surfaced by the repair loop as repair.heightOnly, never patched.
          passes:
            d !== null && m !== null && d >= PARITY_FLOOR && m >= PARITY_FLOOR &&
            r.desktop?.heightPass !== false && r.mobile?.heightPass !== false,
        };
      });
      parity = {
        floor: PARITY_FLOOR,
        // Guard the vacuous case: zero compared pages must not report success.
        allPass: parityPages.length > 0 && parityPages.every((p) => p.passes),
        avgDesktop: avg(scores('desktop')),
        avgMobile: avg(scores('mobile')),
        pages: parityPages,
      };
      // Atomic write (tmp + rename) mirrors normalize-report convention.
      const reportPath = join(outputDir, 'parity-report.json');
      const tmp = `${reportPath}.tmp.${process.pid}`;
      writeFileSync(tmp, JSON.stringify({ schema: 1, comparison, parity }, null, 2) + '\n');
      renameSync(tmp, reportPath);
    } catch (err) {
      warnings.push(`compare failed: ${(err as Error).message}`);
    }
  }

  // Stage 1e — Deterministic parity repair loop (bounded, no AI).
  // Measure → classify → patch → re-capture → re-compare; stop on allPass,
  // maxRepairRounds, or unchanged divergence fingerprint (stuck). Every failure
  // degrades to a warning — the loop never aborts the conversion.
  // REQUIRES carried source css: the parity-patch enqueue rides the carry block
  // in functions.php, so without it the patch file would be written but never
  // loaded — the loop would burn every round with zero on-page effect.
  if (repair && parity && !parity.allPass && maxRepairRounds > 0 && !carriedCss) {
    warnings.push('repair skipped: requires carried source css (carryCss)');
  }
  if (repair && parity && !parity.allPass && maxRepairRounds > 0 && carriedCss) {
    let rounds = 0;
    let lastFingerprint: string | undefined;
    let converged = false;
    const allOverrides = new Map<string, PatchOverride>();
    let allUnresolved: UnresolvedDivergence[] = [];
    // Height-only failures: score ≥ floor but heightPass false — the missing
    // content lives BELOW the min-crop, so the diff PNG carries no red pixels
    // and the probe has nothing to measure. Reported, never patched.
    // Replacement semantics (current state), like allUnresolved.
    let heightOnly: string[] = [];

    // TypeScript needs a local non-nullable reference for the loop (parity is
    // let and may be reassigned inside, preventing narrowing in the while cond).
    let currentParity = parity;

    while (!currentParity.allPass && rounds < maxRepairRounds) {
      const failingPages = currentParity.pages.filter((fp) => !fp.passes);
      heightOnly = []; // rebuilt each round — reflects the CURRENT failing set

      // 1. Read replica manifest to resolve pathname → slug for diff-PNG paths.
      const manifestByPathname = new Map<string, string>();
      try {
        const manifestPath = join(replicaCaptureDir, 'screenshots', 'manifest.json');
        if (existsSync(manifestPath)) {
          const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
            version: 1;
            entries: Record<string, { slug: string }>;
          };
          for (const [url, entry] of Object.entries(m.entries)) {
            try { manifestByPathname.set(new URL(url).pathname, entry.slug); } catch { /* skip */ }
          }
        }
      } catch (err) {
        warnings.push(`repair round ${rounds}: manifest read failed: ${(err as Error).message}`);
        break;
      }

      // 2. Probe both sides for each failing page × viewport.
      const roundDivergences: Divergence[] = [];
      let repairServer: Awaited<ReturnType<typeof startStaticServer>> | undefined;
      let repairBrowser: import('playwright').Browser | undefined;
      let probeOk = true;
      try {
        repairServer = await startStaticServer(dir);
        repairBrowser = await connectBrowser({});

        for (const failPage of failingPages) {
          const slug = manifestByPathname.get(failPage.pathname);
          if (!slug) continue;

          const sitePg = site.pages.find((sp) => {
            const rUrl = sp.slug === plan.homeSlug ? `${wpUrl}/` : `${wpUrl}/${sp.slug}/`;
            return new URL(rUrl).pathname === failPage.pathname;
          });
          if (!sitePg) continue;

          for (const vp of ['desktop', 'mobile'] as const) {
            const score = failPage[vp];
            const vpHeightPass = vp === 'desktop' ? failPage.desktopHeightPass : failPage.mobileHeightPass;
            if (score !== null && score >= PARITY_FLOOR) {
              // Pixel-passing viewport. If it failed ONLY on height, record it:
              // the dropped content sits below the min-crop, the diff PNG has
              // no red pixels, and the probe would measure nothing — patching
              // cannot help; the failure must still be visible in the summary.
              if (vpHeightPass === false) heightOnly.push(`${failPage.pathname} ${vp}`);
              continue;
            }

            const diffPath = join(replicaCaptureDir, 'screenshots', 'diff', `${slug}.${vp}.diff.png`);
            if (!existsSync(diffPath)) continue;

            let regions: ReturnType<typeof extractDiffRegions>;
            try {
              // Same per-viewport scale the screenshotter applied when writing the
              // pngs (screenshotter.ts deviceScaleFactor) — png px → logical px.
              regions = extractDiffRegions(readFileSync(diffPath), {
                scale: vp === 'desktop' ? SCREENSHOT_DEVICE_SCALE_FACTOR : 1,
              });
            } catch { continue; }

            if (regions.length === 0) continue;

            const sourceUrl = repairServer.urlForPage(sitePg.relPath);
            const replicaUrl = sitePg.slug === plan.homeSlug ? `${wpUrl}/` : `${wpUrl}/${sitePg.slug}/`;
            try {
              const divs = await probePair({ browser: repairBrowser, sourceUrl, replicaUrl, viewport: vp, regions });
              roundDivergences.push(...divs);
            } catch (err) {
              warnings.push(`repair round ${rounds}: probe ${failPage.pathname} ${vp}: ${(err as Error).message}`);
            }
          }
        }
      } catch (err) {
        warnings.push(`repair round ${rounds}: probe setup failed: ${(err as Error).message}`);
        probeOk = false;
      } finally {
        await repairBrowser?.close();
        await repairServer?.close();
      }

      if (!probeOk) break;

      // 3. Classify + fingerprint (order-insensitive; same input → same bytes).
      const classifyResult = classifyDivergences(roundDivergences);
      const fp = divergenceFingerprint(roundDivergences);
      if (fp === lastFingerprint) {
        // Patching is not helping — stop and report. The previous round's patch
        // WAS generated and applied but left the divergence set unchanged, so
        // downstream reads this as converged:false with overrides > 0 — the
        // patch-generated-but-ineffective signal.
        // Replacement (not union): currently-blocking only — pages that
        // converged in earlier rounds drop out, unlike the override union.
        allUnresolved = classifyResult.unresolved;
        break;
      }
      lastFingerprint = fp;

      // Accumulate overrides across rounds (union; later rounds can add viewports).
      // The key includes the VALUE (mirrors classify's keying): a prop diverging
      // to different source values per viewport (hero font-size 64px desktop /
      // 32px mobile) must stay TWO overrides so renderPatchCss emits per-viewport
      // media rules — a value-less key would collapse them into one bare rule
      // applying the desktop value to mobile. Source values are stable across
      // rounds (static source pages), so same-viewport key conflicts can't arise.
      for (const o of classifyResult.overrides) {
        const key = `${o.selector}|${o.occurrence}|${o.prop}|${o.value}`;
        const existing = allOverrides.get(key);
        if (existing) {
          for (const v of o.viewports) {
            if (!existing.viewports.includes(v)) existing.viewports.push(v);
          }
        } else {
          allOverrides.set(key, { ...o, viewports: [...o.viewports] });
        }
      }
      // REPLACEMENT (not union) is deliberate: currently-blocking only — pages
      // that converged in earlier rounds drop out, unlike the override union.
      allUnresolved = classifyResult.unresolved;

      // 4. Render byte-stable patch from the accumulated union of overrides.
      // Cross-round safety net: the union can accumulate two values for the
      // same selector|prop|viewport when pages fail in DIFFERENT rounds (one
      // converges, then breaks under the other's global patch). The per-round
      // classifier only sees one round at a time, so suppress page-conflicts
      // over the whole union here — honest report, no last-wins paint.
      const suppressed = suppressPageConflicts(
        [...allOverrides.values()].sort(
          (a, b) => a.selector.localeCompare(b.selector) || a.prop.localeCompare(b.prop),
        ),
      );
      for (const c of suppressed.conflicts) {
        warnings.push(
          `repair: page-conflict (unpatchable globally) ${c.selector} ${c.prop} ${c.viewport}: ${c.values.join(' vs ')}`,
        );
      }
      const mergedPlan: RepairPlan = {
        overrides: suppressed.overrides,
        unresolved: allUnresolved,
      };
      // Nothing deterministically patchable: height-only failures yield no
      // diff pixels (content below the crop), structural-only rounds yield no
      // overrides. Writing here would CLOBBER a prior run's working patch with
      // empty bytes, and the forced re-capture would be pure waste — break and
      // report instead (heightOnly + unresolved carry the honest reasons).
      if (mergedPlan.overrides.length === 0) {
        if (heightOnly.length > 0) {
          warnings.push(
            `repair: height-only failures (content lost below the crop; not deterministically patchable): ${heightOnly.join(', ')}`,
          );
        }
        break;
      }
      const patchCss = renderPatchCss(mergedPlan);

      // 5. Write patch into live theme + output dir (atomic).
      try {
        writeReplicaFilesToHost({
          wpRoot,
          themeSlug,
          themeFiles: [{ relativePath: 'assets/css/parity-patch.css', content: patchCss }],
        });
        const patchOut = join(outputDir, 'parity-patch.css');
        const patchTmp = `${patchOut}.tmp.${process.pid}`;
        writeFileSync(patchTmp, patchCss);
        renameSync(patchTmp, patchOut);
      } catch (err) {
        warnings.push(`repair round ${rounds}: patch write failed: ${(err as Error).message}`);
        break;
      }

      // 6. Re-capture replica (force regenerates pngs) → re-compare.
      try {
        await captureScreenshots({
          urls: replicaUrls,
          outputDir: replicaCaptureDir,
          primaryUrl: wpUrl,
          concurrency: 6, // worker-pool capture (screenshotter drains a shared cursor)
          prepareCapture: freezeMotion,
          force: true,
        });
        const comparison2 = await compareScreenshotDirs({
          originDir: join(sourceCaptureDir, 'screenshots'),
          replicaDir: join(replicaCaptureDir, 'screenshots'),
        });
        const parityPages2 = comparison2.results.map((r) => {
          const d = r.desktop?.score ?? null;
          const m = r.mobile?.score ?? null;
          return {
            pathname: r.pathname,
            desktop: d,
            mobile: m,
            // Carried so the NEXT round can still tell height-only failures apart.
            desktopHeightPass: r.desktop?.heightPass,
            mobileHeightPass: r.mobile?.heightPass,
            // Same heightPass fold as round 0 (see the parityPages comment).
            passes:
              d !== null && m !== null && d >= PARITY_FLOOR && m >= PARITY_FLOOR &&
              r.desktop?.heightPass !== false && r.mobile?.heightPass !== false,
          };
        });
        // Recompute the averages from THIS round's scores — carrying the
        // round-0 averages forward would report stale numbers after the patch
        // improved (or changed) the comparison.
        const r2scores = (k: 'desktop' | 'mobile'): number[] =>
          parityPages2.map((p) => p[k]).filter((s): s is number => s !== null);
        const r2avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
        currentParity = {
          ...currentParity,
          allPass: parityPages2.length > 0 && parityPages2.every((p) => p.passes),
          avgDesktop: r2avg(r2scores('desktop')),
          avgMobile: r2avg(r2scores('mobile')),
          pages: parityPages2,
        };
      } catch (err) {
        warnings.push(`repair round ${rounds}: re-compare failed: ${(err as Error).message}`);
        break;
      }

      rounds++;

      if (currentParity.allPass) {
        converged = true;
        break;
      }
    }

    parity = {
      ...currentParity,
      repair: {
        rounds,
        overrides: allOverrides.size,
        unresolved: allUnresolved,
        converged,
        // Present only when height-only failures exist — pages the loop can
        // never fix (no probeable diff pixels); the honest companion to
        // converged:false in that case.
        ...(heightOnly.length > 0 ? { heightOnly } : {}),
      },
    };
  }

  // Stage 1f — Editor-fidelity surface (BDC Task 5, opt-in, measure-only).
  // Renders each installed page's emitted markup in the live block editor and
  // scores the canvas vs the source desktop screenshot. Warn-level for this
  // carry path (editor lacks the carried source CSS): metric only, no verdict
  // change. Degrades to a warning on any failure (creds/render/Studio).
  let editorReport: { scored: number; skipped: number; avgEditorScore: number | null; repairTasks: number } | undefined;
  if (editorSurface) {
    const pass = process.env.WP_ADMIN_PASS;
    if (!pass) {
      warnings.push('editorSurface skipped: set WP_ADMIN_PASS (editor login credential) in the environment');
    } else if (!wpUrl) {
      warnings.push('editorSurface skipped: replica wpUrl not resolved');
    } else {
      try {
        // Resolve source desktop screenshots via the source manifest (pathname → slug → png).
        const srcManifest = new Map<string, string>();
        try {
          const mp = join(sourceCaptureDir, 'screenshots', 'manifest.json');
          if (existsSync(mp)) {
            const m = JSON.parse(readFileSync(mp, 'utf8')) as { entries?: Record<string, { slug: string }> };
            for (const [url, e] of Object.entries(m.entries ?? {})) {
              try { srcManifest.set(new URL(url).pathname, e.slug); } catch { /* skip */ }
            }
          }
        } catch { /* best-effort */ }
        const editorPages: EditorSurfacePage[] = [];
        for (const inst of installed) {
          const sp = site.pages.find((p) => p.slug === inst.slug);
          if (!sp) continue;
          let markup = '';
          try { markup = readFileSync(composedSidecarPath(outputDir, inst.slug), 'utf8'); } catch { continue; }
          if (!markup.trim()) continue;
          // The static server clean-URLs align source pathnames with WP
          // permalinks, so the source manifest keys on the SAME pathname (/ or
          // /slug/) — not the source .html relPath.
          const pathname = sp.slug === plan.homeSlug ? '/' : `/${sp.slug}/`;
          const srcSlug = srcManifest.get(pathname);
          const srcShot = srcSlug ? join(sourceCaptureDir, 'screenshots', 'desktop', `${srcSlug}.png`) : null;
          editorPages.push({
            pathname,
            slug: inst.slug,
            markup,
            blocksPath: false, // carry path → warn-only
            sourceShotDesktop: srcShot && existsSync(srcShot) ? srcShot : null,
          });
        }
        const session = await openEditorSession({
          wpUrl,
          sitePath: studioSitePath,
          username: process.env.WP_ADMIN_USER ?? 'admin',
          password: pass,
        });
        let surface;
        try {
          surface = await scoreEditorSurface({ session, pages: editorPages, floor: PARITY_FLOOR, diffDir: join(replicaCaptureDir, 'screenshots') });
        } finally {
          await session.close();
        }
        const scored = surface.results.filter((r) => r.editorScore !== null);
        const avg = scored.length > 0 ? scored.reduce((s, r) => s + (r.editorScore ?? 0), 0) / scored.length : null;
        editorReport = {
          scored: scored.length,
          skipped: surface.results.length - scored.length,
          avgEditorScore: avg,
          repairTasks: surface.repairTasks.length,
        };
        const erPath = join(outputDir, 'editor-report.json');
        const erTmp = `${erPath}.tmp.${process.pid}`;
        writeFileSync(erTmp, JSON.stringify({ schema: 1, surface: 'editor', results: surface.results, repairTasks: surface.repairTasks }, null, 2) + '\n');
        renameSync(erTmp, erPath);
      } catch (err) {
        warnings.push(`editorSurface failed: ${(err as Error).message}`);
      }
    }
  }

  const result = ctx.textResult({
    pages: plan.items.length,
    installed: installed.length,
    ...(editorReport !== undefined ? { editorSurface: editorReport } : {}),
    failedInstalls,
    missingSidecars: plan.missingSidecars,
    emptySidecars,
    ingest,
    ...(editableIslands ? { islandsConverted } : {}),
    themeSlug,
    themeWritten,
    frontPageSet,
    designCaptured,
    carried: { css: carriedCss, js: carriedJs },
    conservationLeaks: {
      count: conservationLeaks.length,
      artifact: conservationReportPath,
    },
    conservation,
    // Key OMITTED entirely when the flag is off — default summary stays byte-stable.
    // sticky reports EMISSION (stickyEmitted), not detection — see the header-part
    // site. tabs/slider/modal are per-section counts forwarded from the ingest
    // summary (compose reports = single source of truth).
    ...(behaviors !== undefined
      ? {
          behaviors: {
            reveal: !!behaviors.reveal,
            sticky: stickyEmitted,
            tabs: kindCounts.tabs,
            slider: kindCounts.slider,
            modal: kindCounts.modal,
            gaps: behaviors.gaps.length,
          },
        }
      : {}),
    ...(parity !== undefined ? { parity } : {}),
    warnings,
  });
  if (conservation.status === 'fail') result.isError = true;
  return result;
};
