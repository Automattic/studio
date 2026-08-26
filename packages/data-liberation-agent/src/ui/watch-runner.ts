//
// Watch — streaming runner for `pnpm run liberate <url>`
// =====================================================
//
// Runs adapter.discover + adapter.extract end-to-end for a URL, then layers
// streaming work on top:
//   1. resolve agent CLI selection (flag → env → readline prompt → NO_AGENT)
//   2. if --reset, wipe streaming state before starting
//   3. discover + extract via the existing adapter path
//   4. for each processed URL: per-URL media install, tick-scheduler observe
//   5. drain tick-scheduler → judgmentNeeded markers
//   6. if agent != NO_AGENT: invoke each judgmentNeeded via agent CLI subprocess
//   7. print summary
//
// Deterministic-only mode (NO_AGENT) skips step 6 — judgmentNeeded markers
// land in watch.log and the user can re-run with --agent to fill them in.
//
import { mkdirSync, existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildThemeScaffold } from '../lib/replicate/theme-scaffold.js';
import { assembleDesignTheme } from '../lib/preview/assemble-design-theme.js';
import { extractThemeChromeFromHtml, type ThemeChromeEvidence } from '../lib/replicate/source-chrome.js';
import { writeReplicaFilesToHost } from '../lib/preview/replica-install.js';
import { studioWpRoot } from '../lib/preview/studio-site.js';
import { heuristicBlocks } from '../lib/streaming/heuristic-blocks.js';
import { sanitizeSourceHtml } from '../lib/streaming/html-sanitize.js';
import { extractContentRegion } from '../lib/streaming/content-region.js';
import { prepareInstallContentWithMediaUrls } from '../lib/streaming/post-content-media-rewrite.js';
import { rewriteMediaUrls } from '../lib/streaming/media-url-rewrite.js';
import { BlockFixerClient } from '../lib/streaming/block-fixer-client.js';
import { appendTransform, type BlockTransformEntry } from '../lib/streaming/block-transform-log.js';
import { countBlocks } from '../lib/streaming/block-markup-validate.js';
import { designSidecarPath } from '../lib/screenshot/design-capture-runner.js';
// Note: designSidecarPath(outDir, slug, { mobile: true }) returns the mobile sidecar path.
import type { ExtractedNav } from '../lib/screenshot/nav-extract.js';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { detect } from '../lib/detect-platform/index.js';
import { ExtractionLog } from '../lib/resume-state/index.js';
import { WxrBuilder } from '../lib/wxr/index.js';
import { ImportSession } from '../lib/resume-state/index.js';
import { classifyUrl } from '../lib/extraction/sitemap.js';
import type { PageExtractedEvent } from '../adapters/shared.js';
import { godaddyWmAdapter } from '../adapters/godaddy-wm/index.js';
import { hostingerAdapter } from '../adapters/hostinger/index.js';
import { hubspotAdapter } from '../adapters/hubspot/index.js';
import { shopifyAdapter } from '../adapters/shopify/index.js';
import { squarespaceAdapter } from '../adapters/squarespace/index.js';
import { webflowAdapter } from '../adapters/webflow/index.js';
import { weeblyAdapter } from '../adapters/weebly/index.js';
import { wixAdapter } from '../adapters/wix/index.js';
import type { PlatformAdapter } from '../types.js';
import {
  resolveAgent,
  invokeAgent,
  isNoAgent,
  composeModelFor,
  NO_AGENT,
  type AgentSelection,
  type AgentInvokeResult,
} from '../cli/agent-invoker.js';
import { resetStreamingState } from '../cli/watch-state-reset.js';
import { createTickScheduler, type JudgmentNeeded } from '../lib/streaming/tick-scheduler.js';
import { PendingImportsBuffer } from '../lib/streaming/pending-imports.js';
import type { MediaInstallResult } from '../lib/streaming/media-install.js';
import {
  buildFoundationSampleFromManifest,
  foundationRevDecision,
  readCurrentFoundationInputsDigest,
} from '../lib/streaming/foundation-run-state.js';
import { siteOutputDir, resolveStudioRoot } from '../lib/paths.js';

// Judgments chain multiple skills: foundation-rev runs design-foundations
// (read aggregates + scaffold + validate + save), theme-piece runs replicate
// for installable theme checkpoints, and archetype-template runs replicate for
// any missing/refined archetype templates. These regularly exceed 3min: the
// agent reads screenshots, composes block markup, and writes theme files. 10min
// is a pragmatic ceiling that keeps stuck calls from hanging the run forever.
const JUDGMENT_TIMEOUT_MS = 600_000;

export type WatchPhase =
  | 'resolving-agent'
  | 'resetting'
  | 'detecting'
  | 'discovering'
  | 'extracting'
  | 'starting-preview'
  | 'tick-drain'
  | 'invoking-judgments'
  | 'done'
  | 'error';

export interface WatchEvents {
  onPhase?: (phase: WatchPhase) => void;
  onAgentResolved?: (agent: AgentSelection) => void;
  onResetCompleted?: (removed: string[]) => void;
  /** Fires after platform detection. `signals` is the ordered list of evidence (sitemap.xml, X-Powered-By header, HTML markers, etc). The first entry is the strongest signal — useful as a one-line reason in the UI. */
  onPlatformDetected?: (platform: string, confidence: string, signals: string[]) => void;
  onUrlsDiscovered?: (count: number) => void;
  /** Fires after discover with the per-archetype inventory breakdown ({page: 123, post: 45, ...}). */
  onInventoryCounts?: (counts: Record<string, number>) => void;
  onAdapterLog?: (message: string) => void;
  /** Fires for each `[N/M] Extracting: URL` log line emitted by the extraction loop. */
  onExtractionProgress?: (current: number, total: number, url: string) => void;
  /** Fires per-URL during the pre-extraction screenshot capture step. Without
   *  this the user sees no progress for ~10s × N URLs after discovery
   *  reports "Found N URLs". Same shape as onExtractionProgress. */
  onScreenshotProgress?: (current: number, total: number, url: string) => void;
  onUrlObserved?: (url: string, archetype: string) => void;
  /** Fires the moment preview boot begins (in parallel with discovery). The TUI shows "Preview: starting up…" until onPreviewReady. */
  onPreviewStarting?: () => void;
  /** Fires once the running Studio site is up. Surface this URL in the UI so the user can browse while content keeps streaming in. */
  onPreviewReady?: (info: { url: string; source: 'studio'; siteName?: string }) => void;
  /** Fires when preview startup fails (non-fatal — extraction continues without a live preview). */
  onPreviewFailed?: (error: string) => void;
  onJudgmentsReady?: (judgments: JudgmentNeeded[]) => void;
  /** Fires when an agent invocation starts; the TUI renders a friendly spinner line until the matching onJudgmentInvoked fires. */
  onJudgmentStarted?: (judgment: JudgmentNeeded, indexInQueue: number, total: number) => void;
  onJudgmentInvoked?: (judgment: JudgmentNeeded, result: AgentInvokeResult) => void;
  onJudgmentSkipped?: (judgment: JudgmentNeeded) => void;
  /** Fires when per-URL compose-page-blocks invocation begins (after extraction of that URL). */
  onComposePageStarted?: (url: string, archetype: string) => void;
  /** Fires when per-URL compose-page-blocks finishes. */
  onComposePageCompleted?: (url: string, ok: boolean) => void;
  onError?: (message: string) => void;
}

const ADAPTERS: PlatformAdapter[] = [
  godaddyWmAdapter,
  hostingerAdapter,
  hubspotAdapter,
  shopifyAdapter,
  squarespaceAdapter,
  webflowAdapter,
  weeblyAdapter,
  wixAdapter,
];

function findAdapter(platform: string): PlatformAdapter | null {
  return ADAPTERS.find((a) => a.id === platform) || null;
}

export interface WatchOpts {
  url: string;
  outputDir: string;
  /** Explicit agent selection from --agent flag. Pass NO_AGENT for --no-agent. */
  agent: AgentSelection | null;
  /** When true, wipe streaming state before starting. */
  reset: boolean;
  resume: boolean;
  verbose: boolean;
  delay: number;
  limit: number | null;
  token: string | null;
  cdpPort: number | null;
  adminToken: string | null;
  shopDomain: string | null;
  /** Skip TUI prompts (CI / piped stdin). When agent is unset, use NO_AGENT. */
  nonInteractive: boolean;
  /**
   * When true, activates html-first design capture mode:
   *   - captureDesign is passed to captureScreenshots so CSS/JS aggregates and
   *     design sidecars are written during the screenshot pass.
   *   - At run-end, assembleDesignTheme builds the blank-theme bundle (site.css
   *     + site.js if scripts were captured) and installs + activates it against
   *     the running Studio site.
   *   - The recompose path (foundation-rev, theme-piece, archetype-template
   *     judgments and per-URL compose-page-blocks agent invocations) is gated
   *     off so the blank theme and design sidecars are not overwritten.
   */
  captureDesign?: boolean;
  /**
   * When true, carry the source's first-party JavaScript into the JS aggregate
   * (site.js). Only meaningful when captureDesign=true. Default: false.
   */
  includeScripts?: boolean;
  /** Caller-supplied event callbacks. The TUI plugs into these to render. */
  events?: WatchEvents;
}

/**
 * Prompt the user via readline for which agent to use. Returns NO_AGENT when
 * they pick "None" or skip. Used only when stdin is a TTY and no flag/env is
 * set.
 */
async function promptForAgent(): Promise<AgentSelection> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

  process.stderr.write('\n');
  process.stderr.write('  Select agent CLI (used to invoke skills like compose-page-blocks):\n');
  process.stderr.write('    [1] claude\n');
  process.stderr.write('    [2] codex\n');
  process.stderr.write('    [3] gemini\n');
  process.stderr.write('    [4] None (deterministic-only)\n');
  process.stderr.write('    [5] Other (enter command name)\n');

  const choice = (await ask('  Your choice [1-5]: ')).trim();
  let result: AgentSelection = NO_AGENT;
  if (choice === '1') result = 'claude';
  else if (choice === '2') result = 'codex';
  else if (choice === '3') result = 'gemini';
  else if (choice === '5') {
    const custom = (await ask('  Agent CLI command: ')).trim();
    result = custom || NO_AGENT;
  }
  rl.close();
  return result;
}

/**
 * Build a precise prompt for the agent CLI given a judgmentNeeded marker.
 *
 * The streaming runner has a pre-started Studio site that's already
 * receiving per-URL post inserts (and possibly compose-page-blocks
 * transforms). All theme work must therefore install into that running
 * site — NOT call `liberate_preview`, which would route through
 * `startStudioPreview` and create a `-2` duplicate site.
 *
 * The prompts call `liberate_install_theme` instead, passing the running
 * site's `studioSitePath` directly. They also distinguish first-run (theme
 * dir empty) from refresh, since on first invocation the theme bundle has
 * to be complete enough to activate (style.css + theme.json + index.html
 * + parts/header + parts/footer at minimum).
 */
const BLOCK_CSS_POLICY =
  'Block/CSS policy: Do not emit Custom HTML, core/html, or wp:html blocks. Use existing WordPress core blocks first. CSS belongs in style.css or theme.json/block styles, not inline <style> tags, inline style attributes, or Custom HTML blocks.';
const THEME_CUSTOM_BLOCK_POLICY =
  'Custom block policy: Create theme-embedded custom blocks only when a real source component cannot be represented with existing WordPress core blocks.';
const THEME_JSON_POLICY =
  'Theme.json policy: Do not set settings.spacing.spacingScale.theme to false. If explicit spacingSizes are provided, omit settings.spacing.spacingScale entirely instead of disabling it with false.';

export function buildJudgmentPrompt(
  j: JudgmentNeeded,
  outputDir: string,
  studioSitePath: string | null,
): string {
  // The agent only knows where to install theme files when we tell it. If
  // no Studio site is available (studioSitePath is null), surface that
  // explicitly so the agent doesn't try liberate_preview.
  const themeSlug = deriveThemeSlug(outputDir);
  const installTarget = studioSitePath
    ? `\`liberate_install_theme\` with { outputDir: "${outputDir}", studioSitePath: "${studioSitePath}", themeSlug: "${themeSlug}", themeFiles: [...] }. This exact themeSlug is the runner-created shell theme; use it to overwrite the existing shell theme, not a slug derived from inventory/siteSlug. Custom blocks (rare) are theme-embedded under blocks/<slug>/{src,build}/ — pass them through themeFiles[], NOT a separate plugin. See skills/replicate/SKILL.md §4d for the pre-built artifact rule and functions.php registration loop.`
    : `[no install target (Studio site not available); write theme files to <outputDir>/theme/ for the post-extraction reimport]`;

  // IMPORTANT — claude -p only EXECUTES a skill when the prompt opens with
  // its slash invocation (`/data-liberation:<skill>`). Plain English ("Invoke
  // the design-foundations skill") makes the agent merely *acknowledge* the
  // skill exists and stop. Every prompt below must lead with the slash
  // command for the work to actually happen.
  if (j.kind === 'theme-piece') {
    const piece = typeof j.inputs.themePiece === 'string' ? j.inputs.themePiece : 'foundation';
    const pieceLabel = piece === 'foundation' ? 'theme foundation' : piece;
    const pieceInstructions = themePiecePromptInstructions(piece);
    const briefInstruction = piece === 'foundation'
      ? ''
      : `Read base-theme-brief.md before generating this checkpoint. Treat it as the shared coordination artifact for parallel theme workers.`;
    return [
      `/data-liberation:replicate outputDir=${outputDir}`,
      `Context: streaming watch loop just finished design-foundations. This is the ${pieceLabel} generation pass, one installable checkpoint in the full source-parity theme. Pending page imports are being held until all required base theme pieces install.`,
      `Non-negotiable parity target: the generated theme must match the source site's observed content structure and layout as exactly as WordPress blocks allow. Preserve section order, header/footer structure, navigation labels, CTA placement, media placement/aspect ratios, column counts, alignment, spacing rhythm, and responsive stacking. Do not create a generic theme, placeholder marketing sections, or approximate layouts when source HTML/CSS evidence exists.`,
      `Evidence mode: HTML/CSS-first. Treat rendered HTML, inline/same-origin CSS evidence, palette.json, typography.json, breakpoints.json, design-foundation.json, and extracted source chrome as the primary inputs. Do not open screenshots during this theme-piece pass unless the HTML/CSS/token evidence is ambiguous or a specific visual check is needed.`,
      BLOCK_CSS_POLICY,
      THEME_CUSTOM_BLOCK_POLICY,
      THEME_JSON_POLICY,
      briefInstruction,
      pieceInstructions,
      `Call liberate_replicate_inventory first. Read the homepage rendered HTML for global chrome and visual-system decisions, then read the representative rendered HTML for each observed archetype to identify template needs, content regions, source CSS hooks, section structure, and header/footer markup. Use design-foundation.json for token roles.`,
      `Use screenshots later for verification or fallback only. If you do open a screenshot in this pass, state what HTML/CSS ambiguity it resolved.`,
      `Install with: ${installTarget}. Do not call liberate_preview from the streaming watch loop; that creates or reimports into a separate site instead of the running Studio site.`,
      `Install only the files for this checkpoint in themeFiles[]. Do not re-emit unrelated files from previous or later checkpoints.`,
      `After the install succeeds, print exactly this marker on its own line: DLA_THEME_PIECE_DONE:${piece}`,
      piece === 'homepage'
        ? `Update replicate-state.json's archetypeTemplateMap for homepage if you install templates/index.html so follow-up homepage ticks can skip work already covered by this theme piece.`
        : `Do not update unrelated archetypeTemplateMap entries from this checkpoint.`,
      `Rationale: ${j.rationale}`,
      `Inputs: ${JSON.stringify(j.inputs)}`,
    ].join(' ');
  }
  if (j.kind === 'archetype-template') {
    const tpl = archetypeTemplateFile(j.archetype ?? 'page');
    return [
      `/data-liberation:replicate outputDir=${outputDir} archetype=${j.archetype}`,
      `Context: streaming watch loop just observed the first \`${j.archetype}\` URL. The Studio replica site is already running, receiving content URL-by-URL, AND a baseline theme (style.css + theme.json + functions.php + index.html + generic header/footer parts) is already installed and activated by the runner via liberate_theme_scaffold + liberate_install_theme. Your job is to ADD per-archetype layout + patterns on top AND upgrade the baseline header/footer to match the source chrome.`,
      `Emit these files:`,
      `  - templates/${tpl} (block markup tuned to ${j.archetype} URLs)`,
      `  - patterns/<name>.php for each new section pattern this template composes (hero variants, feature grids, CTAs, etc.) — use foundation tokens (var(--wp--preset--color--<slug>)), no inline hex.`,
      `  - parts/header.html — REPLACE the runner's generic baseline with markup that matches the source site's <header> region. Read 1-2 representative html/<slug>.html files, extract the source header's logo/sitename, nav menu items + URLs, CTA buttons, search, language switcher, social icons. Pick the closest match from references/patterns/ (header-cta when the source has a header CTA, header-simple when it doesn't) and tweak: substitute the real nav items via wp:navigation > wp:page-list (auto-reflects pages) OR explicit wp:navigation-link entries when the source's nav order is curated; substitute the source's CTA label/href in {{CTA_LABEL}}/{{CTA_HREF}}. Skip this file ONLY if the source has no distinguishable header (rare).`,
      `  - parts/footer.html — REPLACE the runner's generic baseline with markup that matches the source site's <footer> region. Extract: column structure (1, 2, 3, or 4 columns?), link groups + headings, social icons, newsletter signup, copyright, legal links. Pick from footer-columns (multi-column with link groups) or footer-minimal (single horizontal row), tweak the headings and link lists to match the source. Footer link groups must be editable wp:navigation blocks with explicit wp:navigation-link children, not plain wp:list links. Copyright text uses {{COPYRIGHT}} slot.`,
      `Do NOT re-emit style.css, theme.json, functions.php, or templates/index.html — those already exist. If you need to tweak theme.json (add a block style, register a pattern category), use a small additive overlay file or wait for a foundation-rev tick instead.`,
      BLOCK_CSS_POLICY,
      THEME_CUSTOM_BLOCK_POLICY,
      THEME_JSON_POLICY,
      `Install with: ${installTarget} — pass ONLY the new + replaced files in themeFiles[]. The install path overwrites by relativePath, so files you include in themeFiles[] replace whatever's currently at that path.`,
      `Update replicate-state.json's archetype→template map on success.`,
      `Rationale: ${j.rationale}`,
      `Inputs: ${JSON.stringify(j.inputs)}`,
    ].join(' ');
  }
  if (j.kind === 'foundation-rev') {
    // SCOPE: foundation-rev runs ONLY design-foundations. Theme bootstrap
    // (style.css / theme.json / templates / parts / patterns) is the
    // archetype-template tick's job, which fires per-archetype after
    // foundation lands. Combining both into one prompt blew past the 10min
    // budget — the agent finished design-foundations (~5min) and was
    // killed mid-theme-generation. Splitting lets composes start as soon
    // as the foundation exists, and theme work runs in its own envelope.
    //
    // Sample budget: make the foundation pass HTML/CSS-first. Aggregate
    // computed files carry the design-system evidence; the single homepage
    // HTML sample is only for semantic disambiguation. Screenshots are a
    // fallback, not default context.
    const sample = buildFoundationSampleFromManifest(outputDir);
    const sampleText = Object.keys(sample).length > 0
      ? JSON.stringify(sample)
      : '{}';
    return [
      `/data-liberation:design-foundations outputDir=${outputDir}`,
      `Evidence mode: HTML/CSS-first. Execute the skill end-to-end against palette.json + typography.json + breakpoints.json + computed-styles.json when present, and ONLY the single representative HTML sample below. Run the scaffold to merge new tokens, fill role slots, validate via liberate_design_foundation_validate, and save via liberate_design_foundation_save.`,
      `Use the homepage rendered HTML as the default semantic sample when available. Hard sample cap: do NOT inspect HTML outside this JSON sample. Do not open screenshots during this step unless the aggregate CSS/HTML evidence is ambiguous; if you do, state the specific ambiguity the screenshot resolved.`,
      `Foundation sample: ${sampleText}`,
      `Success criterion: ${join(outputDir, 'design-foundation.json')} exists on disk when you finish. Do NOT run replicate or generate theme files — that's a separate tick.`,
      `Rationale: ${j.rationale}`,
      `Inputs: ${JSON.stringify(j.inputs)}`,
    ].join(' ');
  }
  // Fallback for unknown judgment kinds
  return `Resolve a streaming judgment in outputDir=${outputDir}. Kind=${j.kind}. Rationale: ${j.rationale}. Inputs: ${JSON.stringify(j.inputs)}.`;
}

export function buildThemePieceBatchPrompt(
  pieces: JudgmentNeeded[],
  outputDir: string,
  studioSitePath: string | null,
): string {
  const themeSlug = deriveThemeSlug(outputDir);
  const installTarget = studioSitePath
    ? `\`liberate_install_theme\` with { outputDir: "${outputDir}", studioSitePath: "${studioSitePath}", themeSlug: "${themeSlug}", themeFiles: [...] }`
    : `[no install target (Studio site not available); write theme files to <outputDir>/theme/ for the post-extraction reimport]`;
  const orderedPieces = pieces
    .map((j) => String(j.inputs.themePiece ?? 'foundation'))
    .filter((piece) => isThemePiece(piece));
  const pieceSections = orderedPieces.map((piece, index) => [
    `${index + 1}. themePiece: "${piece}"`,
    `   ${themePiecePromptInstructions(piece)}`,
    `   Install with ${installTarget}.`,
    `   After the install succeeds, print exactly this marker on its own line: DLA_THEME_PIECE_DONE:${piece}`,
  ].join('\n')).join('\n\n');

  return [
    `/data-liberation:replicate outputDir=${outputDir}`,
    `Run these theme checkpoints in one long-running agent process so inventory, design-foundation, homepage HTML, source chrome, and theme-state context are reused across checkpoints.`,
    `Non-negotiable parity target: every checkpoint must match the source site's observed content structure and layout as exactly as WordPress blocks allow. Do not create generic sections or invented copy.`,
    BLOCK_CSS_POLICY,
    THEME_CUSTOM_BLOCK_POLICY,
    THEME_JSON_POLICY,
    `Call liberate_replicate_inventory once at the start. Read shared evidence once, then execute the checkpoints below in order.`,
    `Install each checkpoint immediately before starting the next checkpoint. Do not wait to install everything at the end.`,
    `Use the exact themeSlug shown in each install target. Do not call liberate_preview from the streaming watch loop.`,
    `Machine-readable progress is required: print each DLA_THEME_PIECE_DONE marker only after that checkpoint's install call succeeds.`,
    `Checkpoints:\n${pieceSections}`,
    `Inputs: ${JSON.stringify(pieces.map((j) => j.inputs))}`,
  ].join(' ');
}

export function buildReplicaBriefMarkdown(opts: {
  outputDir: string;
  studioSitePath: string | null;
  themeSlug: string;
  designFoundation?: unknown;
  evidenceFiles?: {
    homepageHtml?: boolean;
    computedStyles?: boolean;
    palette?: boolean;
    typography?: boolean;
    breakpoints?: boolean;
  };
}): string {
  const evidence = opts.evidenceFiles ?? {};
  const evidenceLines = [
    ['design-foundation.json', true],
    ['computed-styles.json', !!evidence.computedStyles],
    ['palette.json', !!evidence.palette],
    ['typography.json', !!evidence.typography],
    ['breakpoints.json', !!evidence.breakpoints],
    ['html/homepage.html', !!evidence.homepageHtml],
  ].map(([name, present]) => `- ${present ? '[x]' : '[ ]'} ${name}`).join('\n');
  const foundationSummary = opts.designFoundation
    ? JSON.stringify(opts.designFoundation, null, 2)
    : '{}';

  return [
    '# Replica Brief',
    '',
    'This file is the shared coordination artifact for parallel replica theme workers.',
    '',
    '## Install Target',
    '',
    `- Output directory: ${opts.outputDir}`,
    `- Studio site path: ${opts.studioSitePath ?? '(none; Studio site not available)'}`,
    `- Theme slug: ${opts.themeSlug}`,
    '',
    '## Shared Evidence',
    '',
    evidenceLines,
    '',
    '## Source-Parity Rules',
    '',
    '- Match source structure and layout as exactly as WordPress blocks allow.',
    '- Preserve source section order, header/footer structure, navigation labels, CTA placement, media placement, column counts, spacing rhythm, and responsive stacking.',
    '- Use source text and imported media only; do not invent copy or placeholder sections.',
    '- Use design-foundation token roles; do not inline raw hex unless the source evidence has no token role.',
    '- Do not use Custom HTML, core/html, or wp:html blocks.',
    '- Use existing WordPress core blocks first. Create theme-embedded custom blocks only when a source component cannot be represented with core blocks.',
    '- CSS belongs in style.css or theme.json/block styles, not inline <style> tags, inline style attributes, or Custom HTML blocks.',
    '- Do not set `settings.spacing.spacingScale.theme` to `false`. If explicit spacing sizes are needed, omit `settings.spacing.spacingScale` and provide `settings.spacing.spacingSizes`.',
    '',
    '## Parallel Checkpoint Ownership',
    '',
    '- Foundation owns `style.css`, `theme.json`, `functions.php`, and skeletal activation templates.',
    '- Header owns `parts/header.html` and header-specific assets only.',
    '- Footer owns `parts/footer.html` and footer-specific assets only. Footer link groups must be editable `wp:navigation` blocks with explicit `wp:navigation-link` children.',
    '- Homepage owns `templates/index.html` and `patterns/homepage-*` assets/patterns only.',
    '- Workers must not rewrite files owned by another checkpoint.',
    '',
    '## Design Foundation Snapshot',
    '',
    '```json',
    foundationSummary,
    '```',
    '',
  ].join('\n');
}

function writeBaseThemeBrief(outDir: string, studioSitePath: string | null): string {
  const path = join(outDir, BASE_THEME_BRIEF_FILENAME);
  let designFoundation: unknown;
  try {
    designFoundation = JSON.parse(readFileSync(join(outDir, 'design-foundation.json'), 'utf8'));
  } catch {
    designFoundation = undefined;
  }
  const markdown = buildReplicaBriefMarkdown({
    outputDir: outDir,
    studioSitePath,
    themeSlug: deriveThemeSlug(outDir),
    designFoundation,
    evidenceFiles: {
      homepageHtml: existsSync(join(outDir, 'html', 'homepage.html')) || existsSync(join(outDir, 'html', 'index.html')),
      computedStyles: existsSync(join(outDir, 'computed-styles.json')),
      palette: existsSync(join(outDir, 'palette.json')),
      typography: existsSync(join(outDir, 'typography.json')),
      breakpoints: existsSync(join(outDir, 'breakpoints.json')),
    },
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path, markdown, 'utf8');
  appendWatchLog(outDir, { event: 'base-theme-brief-written', path });
  return path;
}

function themePiecePromptInstructions(piece: string): string {
  if (piece === 'foundation') {
    return 'Emit only style.css, theme.json, functions.php, and the minimum base templates required for activation if missing. Keep templates skeletal here; header, footer, homepage, and archetype layouts are separate checkpoints.';
  }
  if (piece === 'header') {
    return 'Emit only parts/header.html and any header-specific patterns/assets required by that part. Match the source header exactly: logo/sitename, nav labels/order/URLs, CTA/search/language/social elements, alignment, spacing, colors, and mobile behavior.';
  }
  if (piece === 'footer') {
    return 'Emit only parts/footer.html and any footer-specific patterns/assets required by that part. Match the source footer exactly: column count, link groups, headings, social/newsletter/legal/copyright content, spacing, colors, and responsive stacking. Footer link groups must be editable wp:navigation blocks with explicit wp:navigation-link children, not plain wp:list links.';
  }
  if (piece === 'homepage') {
    return 'Emit only templates/index.html and homepage patterns/assets. This is the home page layout checkpoint: preserve the source homepage section order, hero composition, real imported media placement, CTA placement, content boundaries, and homepage patterns. Templates must render imported post content in the same source layout shell; homepage patterns must use real source text/media only where the source has reusable global sections.';
  }
  return `Emit only files for the ${piece} theme checkpoint. Preserve exact source content and layout for this checkpoint, and leave unrelated theme files untouched.`;
}

function archetypeTemplateFile(archetype: string): string {
  switch (archetype) {
    case 'homepage': return 'index.html';
    case 'page': return 'page.html';
    case 'post': return 'single.html';
    case 'product': return 'single-product.html';
    case 'gallery': return 'page-gallery.html';
    case 'event': return 'single-event.html';
    default: return `${archetype}.html`;
  }
}

/**
 * Build a per-page compose-page-blocks prompt. Called once per pending URL
 * BEFORE the post is inserted. The skill produces block markup and writes
 * it to a sidecar via `liberate_block_compose`; the runner then reads the
 * sidecar and installs the post with `contentOverride = <blocks>` so the
 * very first DB write of each post carries block markup, not raw HTML
 * that gets transformed afterward.
 *
 * Do NOT use `liberate_block_transform_apply` from this prompt — that path
 * updates an already-imported post, which means raw HTML hits the DB
 * first. The streaming flow is compose-then-install; apply is reserved
 * for re-composing already-imported content (manual rebuild, drift
 * triage).
 */
export function buildComposePagePrompt(opts: {
  url: string;
  outDir: string;
  archetype: string;
  slug: string;
  /**
   * When true, the archetype's template + patterns are already
   * installed — visual treatment is captured in the theme. The compose
   * prompt drops the screenshot reference and tells the agent to do
   * pure HTML→blocks translation. Cuts vision context (the dominant
   * cost) entirely.
   */
  archetypeTemplateExists: boolean;
  /**
   * Pre-loaded sanitized source HTML, embedded directly in the prompt.
   * Saves the agent a Read tool roundtrip per call. Falls back to a
   * path reference when the file can't be read or is too large.
   */
  preloadedHtml?: string;
  /**
   * Pre-loaded design-foundation.json content. Same rationale as
   * preloadedHtml.
   */
  preloadedFoundation?: string;
}): string {
  const htmlPath = join(opts.outDir, 'html', `${opts.slug}.html`);
  const screenshotPath = join(opts.outDir, 'screenshots', 'desktop', `${opts.slug}.png`);
  const lines: string[] = [
    `/data-liberation:compose-page-blocks outputDir=${opts.outDir} url=${opts.url} slug=${opts.slug}`,
    `Page URL: ${opts.url}.`,
    `Archetype: ${opts.archetype}.`,
    `Slug: ${opts.slug}.`,
  ];

  // Vision is the dominant cost. Drop it when the archetype's template
  // is already installed — visual treatment is in the template, all
  // that's left is HTML→blocks translation. First-of-archetype URLs
  // (template not yet installed) keep vision so the agent can ground
  // section structure visually.
  if (!opts.archetypeTemplateExists) {
    lines.push(`Desktop screenshot: ${screenshotPath}`);
  } else {
    lines.push(
      `Desktop screenshot: SKIPPED — templates/${archetypeTemplateFile(opts.archetype)} already exists in the active theme, so visual treatment is captured. Compose from HTML + foundation only; do not Read the screenshot.`,
    );
  }

  if (opts.preloadedHtml) {
    lines.push(
      `Sanitized source HTML (already pre-loaded — do NOT re-read with the Read tool):`,
      '```html',
      opts.preloadedHtml,
      '```',
    );
  } else {
    lines.push(
      `Source HTML: ${htmlPath} (Read this file; sanitize via html-sanitize.ts before composing)`,
    );
  }

  if (opts.preloadedFoundation) {
    lines.push(
      `Design foundation (already pre-loaded — do NOT re-read):`,
      '```json',
      opts.preloadedFoundation,
      '```',
    );
  } else {
    lines.push(`Design foundation: ${join(opts.outDir, 'design-foundation.json')}`);
  }

  lines.push(
    `Produce block markup that uses design-foundation tokens (var(--wp--preset--color--*) slugs), no raw hex, no template parts, no scripts/iframes.`,
    BLOCK_CSS_POLICY,
    `If the source section cannot be represented with existing core blocks and the active theme has not already registered a purpose-built custom block, omit that section and report a warning instead of using Custom HTML.`,
    `Hand the result to the runner by calling \`liberate_block_compose\` with { outputDir: "${opts.outDir}", url: "${opts.url}", slug: "${opts.slug}", blocks: <your markup>, sourceHtml: <the sanitized HTML above>, composedBy: "compose-page-blocks@v1.0" }.`,
    `Do NOT call \`liberate_block_transform_apply\` from this flow — the runner installs the post with your block markup as post_content directly, so apply would either fail (post does not exist yet) or fight the install.`,
    `On success, the watch loop reads <outputDir>/composed/${opts.slug}.blocks.html and uses it for the wp_insert_post call.`,
  );
  return lines.join('\n');
}

// Per-page compose: agent reads source HTML + screenshot + foundation,
// produces block markup, calls liberate_block_compose to validate +
// write the sidecar. 10min covers complex/long pages where vision
// reasoning + emitting block markup runs slow. The sidecar-existence
// check below also salvages composes that wrote their output but were
// killed before claude itself exited cleanly — so a hard timeout here
// only loses pages that genuinely never finished.
const COMPOSE_PAGE_TIMEOUT_MS = 600_000;

async function processThemePieceBatch(opts: {
  pieces: JudgmentNeeded[];
  agent: AgentSelection;
  outDir: string;
  studioSitePath: string | null;
  events: WatchEvents;
  startIndex: number;
  total: number;
}): Promise<{ handled: number; skipped: number }> {
  const pieces = opts.pieces.filter((j) => j.kind === 'theme-piece');
  if (pieces.length === 0) return { handled: 0, skipped: 0 };
  const pieceName = (j: JudgmentNeeded): string => String(j.inputs.themePiece ?? 'foundation');

  const foundation = pieces.find((j) => pieceName(j) === 'foundation');
  if (foundation && pieces.length > 1) {
    const foundationResult = await processThemePieceBatch({
      ...opts,
      pieces: [foundation],
    });
    const rest = pieces.filter((j) => j !== foundation);
    if (foundationResult.handled === 0) {
      for (const judgment of rest) {
        opts.events.onJudgmentSkipped?.(judgment);
        appendWatchLog(opts.outDir, {
          event: 'judgment-skipped',
          judgment,
          reason: 'theme-foundation-failed-before-parallel-checkpoint',
        });
      }
      return { handled: foundationResult.handled, skipped: foundationResult.skipped + rest.length };
    }
    writeBaseThemeBrief(opts.outDir, opts.studioSitePath);
    const parallelResult = await processThemePiecesInParallel({
      ...opts,
      pieces: rest,
      startIndex: opts.startIndex + 1,
    });
    return {
      handled: foundationResult.handled + parallelResult.handled,
      skipped: foundationResult.skipped + parallelResult.skipped,
    };
  }

  if (pieces.length > 1 && pieces.every((j) => pieceName(j) !== 'foundation')) {
    writeBaseThemeBrief(opts.outDir, opts.studioSitePath);
    return processThemePiecesInParallel(opts);
  }
  if (pieces.length === 1 && pieceName(pieces[0]) !== 'foundation') {
    writeBaseThemeBrief(opts.outDir, opts.studioSitePath);
  }

  let handled = 0;
  let skipped = 0;
  let startedIndex = -1;
  const completed = new Set<string>();
  let lineBuffer = '';

  const syntheticSuccess = (): AgentInvokeResult => ({
    agent: opts.agent,
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    durationMs: 0,
  });

  const startNext = (): void => {
    const nextIndex = pieces.findIndex((candidate, index) => (
      index > startedIndex && !completed.has(pieceName(candidate))
    ));
    if (nextIndex === -1) return;
    startedIndex = nextIndex;
    opts.events.onJudgmentStarted?.(pieces[nextIndex], opts.startIndex + nextIndex, opts.total);
  };

  const markDone = (piece: string, result: AgentInvokeResult = syntheticSuccess()): void => {
    if (!isThemePiece(piece) || completed.has(piece)) return;
    const judgment = pieces.find((candidate) => pieceName(candidate) === piece);
    if (!judgment) return;
    completed.add(piece);
    handled += 1;
    markThemePieceHandled(opts.outDir, piece, {
      agent: result.agent,
      durationMs: result.durationMs,
    });
    opts.events.onJudgmentInvoked?.(judgment, {
      ...result,
      exitCode: 0,
      timedOut: false,
    });
    appendWatchLog(opts.outDir, {
      event: 'theme-piece-replicate-handled',
      piece,
      agent: result.agent,
      durationMs: result.durationMs,
      source: 'theme-piece-session',
    });
    startNext();
  };

  const processOutput = (text: string): void => {
    lineBuffer += text;
    while (true) {
      const newline = lineBuffer.search(/\r?\n/);
      if (newline === -1) break;
      const line = lineBuffer.slice(0, newline);
      lineBuffer = lineBuffer.slice(lineBuffer.charAt(newline) === '\r' ? newline + 2 : newline + 1);
      const piece = parseThemePieceDoneMarker(line);
      if (piece) markDone(piece);
    }
  };

  startNext();
  const result = await invokeAgent({
    agent: opts.agent,
    prompt: buildThemePieceBatchPrompt(pieces, opts.outDir, opts.studioSitePath),
    timeoutMs: JUDGMENT_TIMEOUT_MS * pieces.length,
    onStdout: processOutput,
  });
  if (lineBuffer.trim()) {
    const piece = parseThemePieceDoneMarker(lineBuffer);
    if (piece) markDone(piece, result);
  }

  appendWatchLog(opts.outDir, {
    event: 'theme-piece-session-invoked',
    pieces: pieces.map((j) => pieceName(j)),
    agent: result.agent,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stderrTail: result.stderr.slice(-500),
  });

  if (result.exitCode === 0 && !result.timedOut) {
    for (const piece of pieces.map((j) => pieceName(j))) {
      markDone(piece, result);
    }
    return { handled, skipped };
  }

  const firstIncomplete = pieces.find((candidate) => !completed.has(pieceName(candidate)));
  if (firstIncomplete) {
    opts.events.onJudgmentInvoked?.(firstIncomplete, result);
  }
  const remaining = pieces.filter((candidate) => (
    candidate !== firstIncomplete && !completed.has(pieceName(candidate))
  ));
  for (const judgment of remaining) {
    skipped += 1;
    opts.events.onJudgmentSkipped?.(judgment);
    appendWatchLog(opts.outDir, {
      event: 'judgment-skipped',
      judgment,
      reason: 'theme-piece-session-failed-before-this-checkpoint',
    });
  }
  return { handled, skipped };
}

async function processThemePiecesInParallel(opts: {
  pieces: JudgmentNeeded[];
  agent: AgentSelection;
  outDir: string;
  studioSitePath: string | null;
  events: WatchEvents;
  startIndex: number;
  total: number;
}): Promise<{ handled: number; skipped: number }> {
  const results = await Promise.all(opts.pieces.map((judgment, index) => (
    processSingleThemePiece({
      judgment,
      agent: opts.agent,
      outDir: opts.outDir,
      studioSitePath: opts.studioSitePath,
      events: opts.events,
      indexInQueue: opts.startIndex + index,
      total: opts.total,
    })
  )));
  return results.reduce((acc, result) => ({
    handled: acc.handled + result.handled,
    skipped: acc.skipped + result.skipped,
  }), { handled: 0, skipped: 0 });
}

async function processSingleThemePiece(opts: {
  judgment: JudgmentNeeded;
  agent: AgentSelection;
  outDir: string;
  studioSitePath: string | null;
  events: WatchEvents;
  indexInQueue: number;
  total: number;
}): Promise<{ handled: number; skipped: number }> {
  const piece = String(opts.judgment.inputs.themePiece ?? 'foundation');
  let completed = false;
  let lineBuffer = '';

  const markDone = (result: AgentInvokeResult): void => {
    if (!isThemePiece(piece) || completed) return;
    completed = true;
    markThemePieceHandled(opts.outDir, piece, {
      agent: result.agent,
      durationMs: result.durationMs,
    });
    opts.events.onJudgmentInvoked?.(opts.judgment, {
      ...result,
      exitCode: 0,
      timedOut: false,
    });
    appendWatchLog(opts.outDir, {
      event: 'theme-piece-replicate-handled',
      piece,
      agent: result.agent,
      durationMs: result.durationMs,
      source: 'parallel-theme-piece',
    });
  };

  opts.events.onJudgmentStarted?.(opts.judgment, opts.indexInQueue, opts.total);
  const processOutput = (text: string): void => {
    lineBuffer += text;
    while (true) {
      const newline = lineBuffer.search(/\r?\n/);
      if (newline === -1) break;
      const line = lineBuffer.slice(0, newline);
      lineBuffer = lineBuffer.slice(lineBuffer.charAt(newline) === '\r' ? newline + 2 : newline + 1);
      const donePiece = parseThemePieceDoneMarker(line);
      if (donePiece === piece) {
        markDone({
          agent: opts.agent,
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
          durationMs: 0,
        });
      }
    }
  };

  const result = await invokeAgent({
    agent: opts.agent,
    prompt: buildJudgmentPrompt(opts.judgment, opts.outDir, opts.studioSitePath),
    timeoutMs: JUDGMENT_TIMEOUT_MS,
    onStdout: processOutput,
  });
  if (lineBuffer.trim() && parseThemePieceDoneMarker(lineBuffer) === piece) {
    markDone(result);
  }

  appendWatchLog(opts.outDir, {
    event: 'parallel-theme-piece-invoked',
    judgment: opts.judgment,
    agent: result.agent,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stderrTail: result.stderr.slice(-500),
  });

  if (result.exitCode === 0 && !result.timedOut) {
    markDone(result);
  }

  if (completed) {
    return { handled: 1, skipped: 0 };
  }
  opts.events.onJudgmentInvoked?.(opts.judgment, result);
  return { handled: 0, skipped: 0 };
}

/**
 * Run a list of judgmentNeeded markers through the resolved agent CLI.
 * NO_AGENT mode skips invocation; markers are logged for later resolution.
 * Returns counts so the caller can accumulate them and avoid retry loops.
 */
async function processJudgments(
  list: JudgmentNeeded[],
  agent: AgentSelection,
  outDir: string,
  studioSitePath: string | null,
  events: WatchEvents,
  onFoundationDigest?: (digest: string) => void,
): Promise<{ handled: number; skipped: number; themePieceAttempted: boolean }> {
  let handled = 0;
  let skipped = 0;
  let themePieceAttempted = false;
  const queue = maybePrependThemePieceJudgments(list, outDir, agent);
  if (queue.length > list.length) {
    events.onJudgmentsReady?.(queue.slice(0, queue.length - list.length));
  }
  for (let i = 0; i < queue.length; i++) {
    const j = queue[i];
    if (isNoAgent(agent)) {
      skipped += 1;
      events.onJudgmentSkipped?.(j);
      appendWatchLog(outDir, { event: 'judgment-skipped', judgment: j, reason: 'no-agent' });
      continue;
    }
    if (
      j.kind === 'archetype-template' &&
      shouldSkipCoveredArchetypeTemplate(outDir, studioSitePath, j.archetype)
    ) {
      skipped += 1;
      events.onJudgmentSkipped?.(j);
      appendWatchLog(outDir, {
        event: 'judgment-skipped',
        judgment: j,
        reason: 'template already installed by homepage theme piece',
      });
      continue;
    }
    if (j.kind === 'foundation-rev') {
      const decision = foundationRevDecision(outDir);
      if (!decision.shouldRun) {
        skipped += 1;
        events.onJudgmentSkipped?.(j);
        appendWatchLog(outDir, {
          event: 'judgment-skipped',
          judgment: j,
          reason: decision.reason,
          digest: decision.digest,
        });
        if (
          hasPendingThemePieces(outDir, !isNoAgent(agent)) &&
          !queue.some((queued) => queued.kind === 'theme-piece')
        ) {
          const pendingPieces = themePieceJudgmentsPending(outDir, !isNoAgent(agent));
          events.onJudgmentsReady?.(pendingPieces);
          queue.splice(
            i + 1,
            0,
            ...pendingPieces,
          );
        }
        continue;
      }
      appendWatchLog(outDir, {
        event: 'foundation-rev-needed',
        judgment: j,
        reason: decision.reason,
        digest: decision.digest,
      });
    }
    if (j.kind === 'theme-piece') {
      const pieces: JudgmentNeeded[] = [];
      for (let p = i; p < queue.length && queue[p].kind === 'theme-piece'; p++) {
        pieces.push(queue[p]);
      }
      const result = await processThemePieceBatch({
        pieces,
        agent,
        outDir,
        studioSitePath,
        events,
        startIndex: i,
        total: queue.length,
      });
      handled += result.handled;
      skipped += result.skipped;
      themePieceAttempted = true;
      i += pieces.length - 1;
      continue;
    }
    events.onJudgmentStarted?.(j, i, queue.length);
    const prompt = buildJudgmentPrompt(j, outDir, studioSitePath);
    const result = await invokeAgent({ agent, prompt, timeoutMs: JUDGMENT_TIMEOUT_MS });
    events.onJudgmentInvoked?.(j, result);
    appendWatchLog(outDir, {
      event: 'judgment-invoked',
      judgment: j,
      agent: result.agent,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stderrTail: result.stderr.slice(-500),
    });
    if (result.exitCode === 0 && !result.timedOut) {
      handled += 1;
      if (j.kind === 'foundation-rev' && existsSync(join(outDir, 'design-foundation.json'))) {
        const digest = readCurrentFoundationInputsDigest(outDir);
        if (digest) {
          onFoundationDigest?.(digest);
          appendWatchLog(outDir, {
            event: 'foundation-digest-recorded',
            digest,
          });
        }
        if (
          hasPendingThemePieces(outDir, !isNoAgent(agent)) &&
          !queue.some((queued) => queued.kind === 'theme-piece')
        ) {
          const pendingPieces = themePieceJudgmentsPending(outDir, !isNoAgent(agent));
          events.onJudgmentsReady?.(pendingPieces);
          queue.splice(
            i + 1,
            0,
            ...pendingPieces,
          );
        }
      }
    }
  }
  return { handled, skipped, themePieceAttempted };
}

/**
 * Max concurrent compose+install workers in flushPendingImports. Each
 * worker spawns a `claude` subprocess + an MCP server child, so this
 * caps how many agent-backed jobs run in parallel for one flush. 6 is a
 * pragmatic balance: most pages now skip the agent via the
 * heuristic-blocks shortcut, so the pool only churns on the genuinely
 * non-trivial pages — bumping to 6 cuts the wall-clock for the agent-
 * heavy pages further without exhausting CPU on a typical dev machine.
 * Override with DLA_FLUSH_CONCURRENCY env var.
 */
const FLUSH_CONCURRENCY = (() => {
  const raw = process.env.DLA_FLUSH_CONCURRENCY;
  const n = raw ? Number(raw) : 6;
  return Number.isFinite(n) && n >= 1 && n <= 16 ? Math.floor(n) : 6;
})();

/**
 * Drain the pending-imports buffer with COMPOSE-THEN-INSTALL semantics.
 *
 * For each pending URL:
 *   - NO_AGENT mode → install raw HTML immediately (compose unavailable).
 *   - Agent + foundation missing → hold ALL entries (we need the foundation
 *     to compose against). The next foundation-rev tick creates the file
 *     and the subsequent flush picks it up.
 *   - Agent + foundation present → invoke compose-page-blocks first. The
 *     skill writes block markup to <outputDir>/composed/<slug>.blocks.html
 *     via `liberate_block_compose`. The runner reads that sidecar and
 *     calls installPost with `contentOverride = <blocks>` so the very
 *     first DB write carries block markup. If compose fails (agent error,
 *     timeout, sidecar missing), the entry stays QUEUED — we never
 *     install raw HTML when an agent path was supposed to produce blocks.
 *
 * Concurrency: pending entries are processed in parallel up to
 * FLUSH_CONCURRENCY at a time. Each task is independent (foundation +
 * its own html/screenshot), so they don't race on inputs. They DO each
 * append to pending-imports.jsonl on success — appendFileSync of small
 * (<1KB) JSON entries is atomic per-write on Linux/macOS, so the log
 * stays consistent.
 *
 * installPost is idempotent on `_source_url`, so a crash mid-flush is
 * safe — the buffer entry stays `queued` until markImported is appended.
 */

const execFileAsync = promisify(execFile);
const BASE_THEME_REPLICATED_FILENAME = 'base-theme-replicated.json';
const THEME_PIECES_REPLICATED_FILENAME = 'theme-pieces-replicated.json';
const BASE_THEME_BRIEF_FILENAME = 'base-theme-brief.md';
const THEME_PIECES = ['foundation', 'header', 'footer', 'homepage'] as const;
type ThemePiece = (typeof THEME_PIECES)[number];
const THEME_PIECE_DONE_PREFIX = 'DLA_THEME_PIECE_DONE:';

function isThemePiece(piece: string): piece is ThemePiece {
  return (THEME_PIECES as readonly string[]).includes(piece);
}

export function parseThemePieceDoneMarker(line: string): ThemePiece | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(THEME_PIECE_DONE_PREFIX)) return null;
  const piece = trimmed.slice(THEME_PIECE_DONE_PREFIX.length).trim();
  return isThemePiece(piece) ? piece : null;
}

/** Derive the replica theme slug from the output directory name. */
function deriveThemeSlug(outDir: string): string {
  const base = basename(outDir).toLowerCase();
  const sanitized = base.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized ? `${sanitized}-replica` : 'site-replica';
}

export function shouldPrioritizeThemeScaffoldDrain(
  outDir: string,
  studioSitePath: string | null,
  studioDrainRequested: boolean,
): boolean {
  if (!studioDrainRequested || !studioSitePath) return false;
  if (!existsSync(join(outDir, 'design-foundation.json'))) return false;

  const wpRoot = studioWpRoot(studioSitePath);
  if (!wpRoot) return false;

  const themeSlug = deriveThemeSlug(outDir);
  return !existsSync(join(wpRoot, 'wp-content', 'themes', themeSlug, 'style.css'));
}

export function shouldHoldPostFlushForMediaInstall(result: MediaInstallResult): boolean {
  return result.errors.length > 0;
}

export function shouldDeferFoundationJudgment(judgment: JudgmentNeeded, outDir: string): boolean {
  return judgment.kind === 'foundation-rev' && !readCurrentFoundationInputsDigest(outDir);
}

/**
 * Returns true for judgment kinds that belong to the replica/recompose path —
 * design-foundations, theme-piece generation, and archetype-template generation.
 * When html-first design capture is active, these must NOT run: the blank theme
 * + design sidecars replace the replica-theme path. Running both would let two
 * themes compete and cause compose to fight the design fragment.
 */
function isRecomposeJudgment(judgment: JudgmentNeeded): boolean {
  return (
    judgment.kind === 'foundation-rev' ||
    judgment.kind === 'theme-piece' ||
    judgment.kind === 'archetype-template'
  );
}

function readHandledThemePieces(outDir: string): Set<string> {
  if (existsSync(join(outDir, BASE_THEME_REPLICATED_FILENAME))) {
    return new Set(THEME_PIECES);
  }
  try {
    const parsed = JSON.parse(readFileSync(join(outDir, THEME_PIECES_REPLICATED_FILENAME), 'utf8')) as {
      pieces?: Record<string, unknown>;
    };
    return new Set(Object.keys(parsed.pieces ?? {}));
  } catch {
    return new Set();
  }
}

export function themePieceJudgmentsPending(
  outDir: string,
  agentCanReplicate: boolean,
): JudgmentNeeded[] {
  if (!agentCanReplicate) return [];
  if (!existsSync(join(outDir, 'design-foundation.json'))) return [];
  const handled = readHandledThemePieces(outDir);
  return THEME_PIECES
    .filter((piece) => !handled.has(piece))
    .map((piece) => themePieceJudgment(
      outDir,
      piece,
      `Design foundation is ready; generate and install the ${piece} theme checkpoint.`,
    ));
}

function hasPendingThemePieces(outDir: string, agentCanReplicate: boolean): boolean {
  return themePieceJudgmentsPending(outDir, agentCanReplicate).length > 0;
}

export function markThemePieceHandled(
  outDir: string,
  piece: string,
  meta: { agent: string; durationMs: number },
): void {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, THEME_PIECES_REPLICATED_FILENAME);
  let pieces: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { pieces?: Record<string, unknown> };
    pieces = parsed.pieces ?? {};
  } catch {
    pieces = {};
  }
  pieces[piece] = {
    handledAt: new Date().toISOString(),
    agent: meta.agent,
    durationMs: meta.durationMs,
  };
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      pieces,
    }, null, 2),
    'utf8',
  );
}

function themePieceJudgment(outDir: string, piece: ThemePiece, rationale: string): JudgmentNeeded {
  return {
    kind: 'theme-piece',
    rationale,
    inputs: {
      outputDir: outDir,
      themePiece: piece,
      tickReason: 'foundation-ready',
    },
  };
}

function finalFoundationJudgment(outDir: string): JudgmentNeeded {
  return {
    kind: 'foundation-rev',
    rationale: 'Final extraction drain has aggregate design inputs; generate the design foundation before theme-piece replication.',
    inputs: {
      outputDir: outDir,
      tickReason: 'final',
    },
  };
}

export function ensureFinalFoundationJudgment(
  list: JudgmentNeeded[],
  outDir: string,
): JudgmentNeeded[] {
  if (existsSync(join(outDir, 'design-foundation.json'))) return list;
  if (!readCurrentFoundationInputsDigest(outDir)) return list;
  if (list.some((j) => j.kind === 'foundation-rev')) return list;
  return [finalFoundationJudgment(outDir), ...list];
}

function maybePrependThemePieceJudgments(
  list: JudgmentNeeded[],
  outDir: string,
  agent: AgentSelection,
): JudgmentNeeded[] {
  const queue = [...list];
  if (queue.some((j) => j.kind === 'theme-piece')) return queue;
  // If a foundation-rev is already queued, let it run first. On success,
  // processJudgments inserts theme-piece replicate passes immediately after it.
  if (queue.some((j) => j.kind === 'foundation-rev')) return queue;
  return [...themePieceJudgmentsPending(outDir, !isNoAgent(agent)), ...queue];
}

function shouldSkipCoveredArchetypeTemplate(
  outDir: string,
  studioSitePath: string | null,
  archetype: string | undefined,
): boolean {
  if (!archetype) return false;
  if (!readHandledThemePieces(outDir).has('homepage')) return false;
  if (!studioSitePath) return false;
  const wpRoot = studioWpRoot(studioSitePath);
  if (!wpRoot) return false;
  const templatePath = join(
    wpRoot,
    'wp-content',
    'themes',
    deriveThemeSlug(outDir),
    'templates',
    archetypeTemplateFile(archetype),
  );
  return existsSync(templatePath);
}

/**
 * Install the deterministic theme bootstrap (style.css + theme.json +
 * functions.php + index.html + header/footer parts) into the running
 * Studio site, then activate it. Idempotent — checks for an existing
 * `style.css` under the theme dir and short-circuits when the bootstrap
 * is already on disk. Per-archetype templates and patterns are
 * generated by the agent in archetype-template ticks; this only ships
 * the activatable shell so the rest of the run has a real theme to
 * extend rather than the WordPress default.
 */
async function installScaffoldIfNeeded(opts: {
  outDir: string;
  studioSitePath: string;
  siteTitle?: string;
  sourceUrl?: string;
  mediaUrlMap?: Map<string, string>;
  events: WatchEvents;
}): Promise<{ installed: boolean; reason?: string; warnings?: string[] }> {
  const foundationPath = join(opts.outDir, 'design-foundation.json');
  if (!existsSync(foundationPath)) {
    return { installed: false, reason: 'design-foundation.json missing' };
  }
  const wpRoot = studioWpRoot(opts.studioSitePath);
  if (!wpRoot) {
    return { installed: false, reason: 'studioSitePath has no wp-content' };
  }

  const themeSlug = deriveThemeSlug(opts.outDir);
  const themeDir = join(wpRoot, 'wp-content', 'themes', themeSlug);
  if (existsSync(join(themeDir, 'style.css'))) {
    // Already installed by an earlier tick. The runner's bootstrap is a
    // one-shot — agent-driven archetype-template ticks layer on top.
    return { installed: false, reason: 'already installed' };
  }

  let foundation: unknown;
  try {
    foundation = JSON.parse(readFileSync(foundationPath, 'utf8'));
  } catch (err) {
    return { installed: false, reason: `foundation parse failed: ${(err as Error).message}` };
  }

  const themeFiles = buildThemeScaffold({
    foundation: foundation as Parameters<typeof buildThemeScaffold>[0]['foundation'],
    themeSlug,
    siteTitle: opts.siteTitle,
    sourceChrome: loadThemeChromeEvidence({
      outDir: opts.outDir,
      sourceUrl: opts.sourceUrl ?? opts.siteTitle ?? '',
      mediaUrlMap: opts.mediaUrlMap,
    }),
  });
  try {
    writeReplicaFilesToHost({ wpRoot, themeSlug, themeFiles });
  } catch (err) {
    return { installed: false, reason: `write failed: ${(err as Error).message}` };
  }

  const warnings: string[] = [];
  try {
    const { stdout } = await execFileAsync(
      'studio',
      ['wp', '--path', opts.studioSitePath, 'theme', 'activate', themeSlug],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
    void stdout;
  } catch (err) {
    warnings.push(`Theme activate "${themeSlug}" failed: ${(err as Error).message.trim()}`);
  }
  return { installed: true, warnings };
}

function loadThemeChromeEvidence(opts: {
  outDir: string;
  sourceUrl: string;
  mediaUrlMap?: Map<string, string>;
}): ThemeChromeEvidence | undefined {
  const candidates = [
    join(opts.outDir, 'html', 'homepage.html'),
    join(opts.outDir, 'html', 'index.html'),
  ];
  const htmlPath = candidates.find((path) => existsSync(path));
  if (!htmlPath || !opts.sourceUrl) return undefined;

  try {
    const chrome = extractThemeChromeFromHtml(readFileSync(htmlPath, 'utf8'), opts.sourceUrl);
    return localizeThemeChromeMedia(chrome, opts.mediaUrlMap);
  } catch {
    return undefined;
  }
}

function localizeThemeChromeMedia(
  chrome: ThemeChromeEvidence,
  mediaUrlMap?: Map<string, string>,
): ThemeChromeEvidence {
  const header = chrome.header;
  if (!header?.logoUrl) return chrome;
  const logoUrl = header.logoUrl;

  const rewritten = mediaUrlMap && mediaUrlMap.size > 0
    ? rewriteMediaUrls(`<img src="${logoUrl}">`, mediaUrlMap)
    : '';
  const localLogo = rewritten.match(/\bsrc="([^"]+)"/)?.[1];
  if (!localLogo || localLogo === logoUrl) {
    return {
      ...chrome,
      header: {
        ...header,
        logoUrl: undefined,
      },
    };
  }

  return {
    ...chrome,
    header: {
      ...header,
      logoUrl: localLogo,
    },
  };
}

/**
 * Try the deterministic heuristic-blocks transformer on the sanitized
 * source HTML for a URL. When the page matches a recognised trivial
 * shape (text-only, image+text, single section + heading + text), the
 * heuristic emits valid block markup directly and the runner writes the
 * sidecar + appends a block-transform-log entry — skipping the agent
 * entirely. Returns `{handled: false}` for any non-trivial shape, in
 * which case the caller falls through to the agent compose path.
 */
function tryHeuristicShortcut(opts: {
  outDir: string;
  url: string;
  slug: string;
  sidecar: string;
}): { handled: boolean; blocks?: string; blocksCount?: number; reason?: string } {
  const htmlPath = join(opts.outDir, 'html', `${opts.slug}.html`);
  if (!existsSync(htmlPath)) {
    return { handled: false, reason: 'no html file' };
  }
  let raw: string;
  try {
    raw = readFileSync(htmlPath, 'utf8');
  } catch {
    return { handled: false, reason: 'html read failed' };
  }
  const sanitized = sanitizeSourceHtml(raw);
  const result = heuristicBlocks(sanitized);
  if (!result.handled || !result.blocks) {
    return { handled: false, reason: result.reason ?? 'heuristic returned not-handled' };
  }

  // Persist the block markup to the same sidecar path the agent path
  // would have written, so the rest of the flush is identical.
  try {
    mkdirSync(dirname(opts.sidecar), { recursive: true });
    writeFileSync(opts.sidecar, result.blocks, 'utf8');
  } catch (err) {
    // Sidecar write failed → we can't trust the on-disk state, fall
    // through to the agent path so we don't double-write inconsistent
    // results.
    return { handled: false, reason: `sidecar write failed: ${(err as Error).message}` };
  }

  // Append to the same block-transform-log the apply/compose handlers
  // use, so audit/idempotency is consistent across the heuristic and
  // agent paths.
  const sourceHash = sha256Hex(sanitized);
  const outputHash = sha256Hex(result.blocks);
  const blocksCount = countBlocks(result.blocks);
  const entry: BlockTransformEntry = {
    url: opts.url,
    slug: opts.slug,
    blocksCount,
    transformedAt: new Date().toISOString(),
    source: 'heuristic',
    warnings: [],
    composedBy: 'heuristic-blocks@v1.0',
    sourceHash,
    outputHash,
  };
  try {
    appendTransform(opts.outDir, entry);
  } catch {
    // Log failure isn't fatal — sidecar is still on disk.
  }
  return { handled: true, blocks: result.blocks, blocksCount, reason: result.reason };
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function flushPendingImports(opts: {
  buffer: PendingImportsBuffer;
  outDir: string;
  studioSitePath: string;
  agent: AgentSelection;
  events: WatchEvents;
  /** Run-wide source URL → local upload URL map. Used to rewrite remote
   *  CDN URLs in the compose output (which the agent copied verbatim
   *  from the source HTML) to the local Studio upload URLs registered
   *  by installMediaForUrl. Pass an empty map to skip rewriting. */
  mediaUrlMap: Map<string, string>;
  /** Persistent block-fixer subprocess. When ready, every composed-blocks
   *  payload is round-tripped through it to canonicalize WP markup
   *  (re-serialize via createBlock, flatten nested <p>) before insert.
   *  Pass null to skip — markup goes to install unchanged. */
  blockFixer: BlockFixerClient | null;
  /**
   * When true (html-first design capture mode), skip the agent
   * compose-page-blocks path entirely. Design sidecars already carry the
   * wrapped fragment as contentOverride; the heuristic / raw-html fallback
   * still runs if no sidecar is present. This prevents compose from
   * fighting the design fragment or installing block markup on top of it.
   */
  designCaptureActive?: boolean;
  /**
   * Optional callback fired after each successful post install. Receives
   * the entry archetype and the WordPress post ID assigned by install-post.php.
   * Used by the caller to capture the homepage post ID for front-page wiring.
   */
  onPostInstalled?: (archetype: string, postId: number) => void;
}): Promise<{ imported: number; held: number }> {
  const { buffer, outDir, studioSitePath, agent, events, mediaUrlMap, blockFixer } = opts;
  // In html-first mode the compose path is gated off: design sidecars are the
  // canonical content source, and the blank theme replaces compose+replicate.
  const composeAvailable = !isNoAgent(agent) && !opts.designCaptureActive;
  const foundationReady = existsSync(join(outDir, 'design-foundation.json'));
  const pending = buffer.listPending();

  // Refresh mediaUrlMap from MediaStubStore before any rewrites. The run-wide
  // accumulator (populated incrementally in the per-URL extraction loop) can
  // miss entries in two cases that bit us in production:
  //   (1) URLs whose adapter.extract returned no new items (resume case,
  //       extraction-log dedupe) — installMediaForUrl was gated on
  //       `newItems.length > 0` so the call never ran for those URLs.
  //   (2) Already-installed stubs that installMediaForUrl previously skipped
  //       — they never appeared in `result.installed` so the run-wide map
  //       lost their mapping after a crash + resume.
  // Reading the persisted stubs every flush makes both paths self-healing:
  // the source-of-truth is what's actually on disk + registered in WP, not
  // an in-memory accumulator that may have missed entries.
  try {
    const { MediaStubStore } = await import('../lib/resume-state/index.js');
    const stubs = MediaStubStore.load(outDir);
    let added = 0;
    for (const [sourceUrl, stub] of stubs.list()) {
      if (stub.localUrl && !mediaUrlMap.has(sourceUrl)) {
        mediaUrlMap.set(sourceUrl, stub.localUrl);
        added += 1;
      }
    }
    if (added > 0) {
      appendWatchLog(outDir, {
        event: 'media-url-map-refreshed',
        addedFromStubs: added,
        totalSize: mediaUrlMap.size,
      });
    }
  } catch (err) {
    appendWatchLog(outDir, { event: 'media-url-map-refresh-failed', error: (err as Error).message });
  }

  // Hold everything when an agent is configured but the foundation hasn't
  // been generated yet. The whole point of the buffer is to install with
  // foundation-aware blocks, not raw HTML.
  if (composeAvailable && !foundationReady) {
    return { imported: 0, held: pending.length };
  }
  if (pending.length === 0) {
    return { imported: 0, held: 0 };
  }

  const { installPost } = await import('../lib/streaming/post-install.js');
  const { readFileSync, existsSync: fileExists } = await import('node:fs');

  type EntryResult = { entry: typeof pending[number]; status: 'imported' | 'held' };

  const processOne = async (entry: typeof pending[number]): Promise<EntryResult> => {
    let contentOverride: string | undefined;
    let composedAs: 'blocks' | 'raw-html' = 'raw-html';

    // Design-fragment sidecar: highest precedence content source. Written
    // deterministically by captureDesignForUrl (desktop) and captureMobileBodyFragment
    // (mobile) during the screenshot/capture pass — independent of agent availability
    // or foundation readiness.
    //
    // Dual-viewport toggle: when BOTH the desktop and mobile sidecars exist, build a
    // responsive contentOverride with `.dla-content-desktop` + `.dla-content-mobile`
    // wrappers (already applied by wrapFragment / wrapMobileFragment). The toggle CSS
    // (emitted by buildBlankTheme) shows the desktop block at ≥769px and the mobile
    // block at ≤768px. When only the desktop sidecar exists (mobile capture failed or
    // not yet run), fall back to the desktop fragment alone.
    //
    // Media URL rewrite covers both fragments — the existing mediaUrlMap keys by source
    // URL so the same image referenced in both fragments is rewritten once and deduped
    // by the map lookup. No extra de-duplication step needed.
    const designSidecar = designSidecarPath(outDir, entry.slug);
    const designSidecarMobile = designSidecarPath(outDir, entry.slug, { mobile: true });
    if (fileExists(designSidecar)) {
      try {
        const desktopFragment = readFileSync(designSidecar, 'utf8');
        if (desktopFragment.trim().length > 0) {
          let combined = desktopFragment;
          // If the mobile sidecar also exists, concatenate for responsive toggle.
          if (fileExists(designSidecarMobile)) {
            try {
              const mobileFragment = readFileSync(designSidecarMobile, 'utf8');
              if (mobileFragment.trim().length > 0) {
                combined = desktopFragment + '\n' + mobileFragment;
              }
            } catch {
              // Mobile sidecar unreadable → fall back to desktop-only.
            }
          }
          appendWatchLog(outDir, {
            event: 'design-sidecar-used',
            url: entry.url,
            slug: entry.slug,
            bytes: combined.length,
            hasDesktop: true,
            hasMobile: combined !== desktopFragment,
          });
          contentOverride = combined;
          composedAs = 'raw-html';
        }
      } catch {
        // Unreadable sidecar → fall through to composed / heuristic / agent paths.
      }
    }

    if (composeAvailable && foundationReady) {
      const sidecarPath = join(outDir, 'composed', `${entry.slug}.blocks.html`);

      // Resume-cache check: a sidecar from a prior run is the canonical
      // compose output for this URL. If it's already on disk, reuse it
      // and skip both heuristic + agent. On a 10-page resume run this
      // saves 50-70 minutes of compose cost. Force a re-compose by
      // deleting `composed/<slug>.blocks.html` or running with --reset
      // (watch-state-reset.ts already lists `composed/` as a target).
      // Skip when the design sidecar already populated contentOverride —
      // the design fragment takes precedence over all compose paths.
      if (!contentOverride && fileExists(sidecarPath)) {
        try {
          const cached = readFileSync(sidecarPath, 'utf8');
          if (cached.trim().length > 0) {
            appendWatchLog(outDir, {
              event: 'compose-sidecar-cached',
              url: entry.url,
              slug: entry.slug,
              bytes: cached.length,
            });
            contentOverride = cached;
            composedAs = 'blocks';
          }
        } catch {
          // Unreadable sidecar → fall through to heuristic + agent.
        }
      }

      // Heuristic-blocks shortcut: for trivially-structured pages
      // (text-only, image+text, single section + heading + text), we
      // can emit valid block markup deterministically from the
      // sanitized HTML in milliseconds — no agent needed. Many content
      // pages (about, contact, FAQ, terms) match these shapes;
      // skipping the agent on those typically saves 5–7 min per URL.
      // Skip when the cache already populated contentOverride.
      const heuristic = contentOverride
        ? { handled: false as const, blocks: undefined, blocksCount: 0, reason: 'cache-hit' as const }
        : tryHeuristicShortcut({
            outDir,
            url: entry.url,
            slug: entry.slug,
            sidecar: sidecarPath,
          });
      if (heuristic.handled && heuristic.blocks) {
        appendWatchLog(outDir, {
          event: 'compose-heuristic-applied',
          url: entry.url,
          slug: entry.slug,
          blocksCount: heuristic.blocksCount,
          reason: heuristic.reason,
        });
        contentOverride = heuristic.blocks;
        composedAs = 'blocks';
      } else if (!contentOverride) {
        events.onComposePageStarted?.(entry.url, entry.archetype);

        // Pre-load the inputs the agent would otherwise fetch with
        // Read tool calls. Saves ~30-60s of round-trips per compose.
        // Cap embedded HTML at 60KB so the prompt stays well under
        // claude's context window even on content-heavy pages.
        //
        // Pipeline (per content-region.ts):
        //   raw HTML
        //     → sanitizeSourceHtml() (strip script/style/etc.)
        //     → extractContentRegion() (try <main>, then text-density,
        //       then body-minus-chrome — strips header/nav/footer
        //       chrome that the agent would otherwise have to ignore)
        //     → truncate at PRELOAD_HTML_MAX
        //
        // Measurement (scripts/measure-heuristic-hitrate.ts) showed
        // the extractor cuts 200-700KB raw pages down to 35-130KB of
        // actual content on shopify/wix/hubspot — that's the same
        // 5-10x reduction the agent's prompt now benefits from.
        const PRELOAD_HTML_MAX = 60_000;
        let preloadedHtml: string | undefined;
        let preloadStats: { regionSource: string; rawBytes: number; extractedBytes: number; truncated: boolean } | null = null;
        const htmlPath = join(outDir, 'html', `${entry.slug}.html`);
        if (fileExists(htmlPath)) {
          try {
            const raw = readFileSync(htmlPath, 'utf8');
            const sanitized = sanitizeSourceHtml(raw);
            const region = extractContentRegion(sanitized);
            const truncated = region.html.length > PRELOAD_HTML_MAX;
            preloadedHtml = truncated
              ? region.html.slice(0, PRELOAD_HTML_MAX) + '\n<!-- ... [truncated for prompt size] -->'
              : region.html;
            preloadStats = {
              regionSource: region.source,
              rawBytes: sanitized.length,
              extractedBytes: region.outputBytes,
              truncated,
            };
          } catch {
            // Fall through; prompt will reference the path instead.
          }
        }
        let preloadedFoundation: string | undefined;
        const foundationPath = join(outDir, 'design-foundation.json');
        if (fileExists(foundationPath)) {
          try {
            preloadedFoundation = readFileSync(foundationPath, 'utf8');
          } catch { /* ignore */ }
        }

        // Skip vision when the archetype template is already installed
        // in the active theme. The visual treatment is captured there;
        // per-page work is HTML→block translation only.
        const themeSlug = deriveThemeSlug(outDir);
        const wpRoot = studioWpRoot(studioSitePath);
        const tplFileName = archetypeTemplateFile(entry.archetype);
        const archetypeTemplateExists = wpRoot
          ? fileExists(join(wpRoot, 'wp-content', 'themes', themeSlug, 'templates', tplFileName))
          : false;

        const composePrompt = buildComposePagePrompt({
          url: entry.url,
          outDir,
          archetype: entry.archetype,
          slug: entry.slug,
          archetypeTemplateExists,
          preloadedHtml,
          preloadedFoundation,
        });
        let cleanExit = false;
        try {
          // Compose is mostly schema translation, not heavy reasoning —
          // a "fast" model (Haiku for claude, gpt-4.1-mini for codex,
          // etc.) is 3-5x faster + cheaper here. The reasoning ticks
          // (design-foundations / replicate) keep the agent's default
          // model so they get full vision + semantic mapping power.
          // Override the per-agent fast model via DLA_FAST_MODEL_<AGENT>.
          const r = await invokeAgent({
            agent,
            prompt: composePrompt,
            timeoutMs: COMPOSE_PAGE_TIMEOUT_MS,
            model: composeModelFor(agent) ?? undefined,
          });
          cleanExit = r.exitCode === 0 && !r.timedOut;
          appendWatchLog(outDir, {
            event: 'compose-page-attempted',
            url: entry.url,
            ok: cleanExit,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            durationMs: r.durationMs,
            visionSkipped: archetypeTemplateExists,
            htmlPreloaded: !!preloadedHtml,
            // Compression stats from extractContentRegion. Lets us
            // see in real runs whether <main> is firing on this site
            // or whether we're falling through to text-density /
            // body-minus-chrome.
            preloadStats,
          });
        } catch (err) {
          appendWatchLog(outDir, { event: 'compose-page-failed', url: entry.url, error: (err as Error).message });
        }

        // Sidecar-first salvage: the agent may have written the sidecar
        // via `liberate_block_compose` BEFORE hitting the timeout (we've
        // seen claude get killed mid-final-line after the MCP call
        // already landed). The sidecar's existence is the success
        // signal — claude's own exit code only tells us whether the
        // process unwound cleanly.
        const sidecarPresent = fileExists(sidecarPath);
        const composeOk = sidecarPresent;
        events.onComposePageCompleted?.(entry.url, composeOk);

        if (!composeOk) {
          appendWatchLog(outDir, {
            event: 'compose-sidecar-missing',
            url: entry.url,
            slug: entry.slug,
            expected: sidecarPath,
            cleanExit,
          });
          return { entry, status: 'held' };
        }
        if (!cleanExit) {
          appendWatchLog(outDir, {
            event: 'compose-sidecar-salvaged',
            url: entry.url,
            slug: entry.slug,
            reason: 'sidecar present despite non-clean exit',
          });
        }
        contentOverride = readFileSync(sidecarPath, 'utf8');
        composedAs = 'blocks';
      }
    }

    // Rewrite remote source URLs → local Studio upload URLs before
    // insert. The agent (and the heuristic) both copy the source's
    // <img src> attributes verbatim from the sanitized HTML, so the
    // sidecar references the source CDN directly. Without this swap
    // the imported posts hot-link images from the source — broken on
    // takedown, leaked analytics on every page view, and the user
    // staring at remote URLs wondering where the upload step went.
    if (mediaUrlMap.size > 0) {
      const rewrite = prepareInstallContentWithMediaUrls({
        sourceContent: String((entry.payload as { content?: string }).content ?? ''),
        contentOverride,
        mediaUrlMap,
      });
      contentOverride = rewrite.contentOverride;
      if (rewrite.rewritten || rewrite.missing.length > 0) {
        appendWatchLog(outDir, {
          event: 'media-url-rewrite',
          url: entry.url,
          rewritten: rewrite.rewritten,
          missingCount: rewrite.missing.length,
          missingSample: rewrite.missing.slice(0, 5),
          mapSize: mediaUrlMap.size,
          source: rewrite.usedSourceContent ? 'source-content' : 'content-override',
        });
      }
    }

    // Block-fixer normalize: round-trip the composed markup through
    // @wordpress/blocks parse() + serialize() so it lands in the DB in
    // canonical WP form. This catches subtle differences (attribute
    // order, missing wp-block-* classes, nested <p>) that would
    // otherwise fail WordPress's block validator on next render.
    // Only blocks-mode payloads — raw-html (NO_AGENT) bypasses.
    if (contentOverride && composedAs === 'blocks' && blockFixer) {
      const before = contentOverride;
      const [fix] = await blockFixer.fix([contentOverride]);
      if (fix) {
        contentOverride = fix.html;
        if (fix.changed || fix.fixedIssues.length > 0) {
          appendWatchLog(outDir, {
            event: 'block-fixer-applied',
            url: entry.url,
            slug: entry.slug,
            changed: fix.changed,
            issuesCount: fix.fixedIssues.length,
            issuesSample: fix.fixedIssues.slice(0, 5),
            beforeBytes: before.length,
            afterBytes: contentOverride.length,
          });
        }
      }
    }

    let result: { postId: number | null; action: 'inserted' | 'updated' | 'error'; error?: string } | null;
    try {
      result = await installPost({
        item: entry.payload,
        outputDir: outDir,
        studioSitePath,
        contentOverride,
      });
    } catch (err) {
      appendWatchLog(outDir, { event: 'post-install-failed', url: entry.url, error: (err as Error).message });
      return { entry, status: 'held' };
    }
    appendWatchLog(outDir, {
      event: 'post-installed',
      url: entry.url,
      postId: result?.postId ?? null,
      action: result?.action ?? 'error',
      composedAs,
      // Surface install-post.php's error when it's non-null. Without
      // this, "action: error" entries are unactionable mysteries.
      error: result?.error ?? null,
    });

    buffer.markImported({
      url: entry.url,
      postId: result?.postId ?? null,
      action: result?.action ?? 'error',
      composedAs,
    });
    if (result?.postId != null && opts.onPostInstalled) {
      opts.onPostInstalled(entry.archetype, result.postId);
    }
    return { entry, status: 'imported' };
  };

  // Concurrency pool — keeps FLUSH_CONCURRENCY workers running until the
  // queue drains. Workers pull entries off a shared index, so a slow
  // compose doesn't block a fast one.
  const concurrency = Math.min(FLUSH_CONCURRENCY, pending.length);
  let nextIndex = 0;
  const results: EntryResult[] = [];
  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= pending.length) return;
      const r = await processOne(pending[i]);
      results.push(r);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  let imported = 0;
  let held = 0;
  for (const r of results) {
    if (r.status === 'imported') imported += 1;
    else held += 1;
  }
  return { imported, held };
}

/** Minimal channel-only WXR. Lets startPreview boot the site before any
 * URLs have been extracted — the user gets the URL early; content lands
 * in a follow-up preview restart after the real extraction completes. */
const STUB_WXR = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
<title>Imported Site</title>
<link></link>
<description></description>
<language>en-US</language>
<wp:wxr_version>1.2</wp:wxr_version>
</channel>
</rss>
`;

function ensureStubWxr(outputDir: string): void {
  const wxrPath = join(outputDir, 'output.wxr');
  if (!existsSync(wxrPath)) {
    writeFileSync(wxrPath, STUB_WXR, 'utf8');
  }
}

function appendWatchLog(outputDir: string, entry: Record<string, unknown>): void {
  const logPath = join(outputDir, 'watch.log');
  try {
    appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // best-effort; watch.log is post-mortem only
  }
}

export async function runWatch(opts: WatchOpts): Promise<{ ok: boolean; durationMs: number; processedUrls: number; judgmentsHandled: number; judgmentsSkipped: number }> {
  const start = Date.now();
  const events = opts.events ?? {};
  const outDir = siteOutputDir(opts.outputDir, opts.url);
  mkdirSync(outDir, { recursive: true });

  // Reset path
  if (opts.reset) {
    events.onPhase?.('resetting');
    const r = resetStreamingState(outDir);
    events.onResetCompleted?.(r.removed);
    appendWatchLog(outDir, { event: 'reset', removed: r.removed, skipped: r.skipped });
  }

  // Resolve agent
  events.onPhase?.('resolving-agent');
  let agent: AgentSelection;
  const fromFlagOrEnv = resolveAgent({ agent: opts.agent ?? undefined });
  if (fromFlagOrEnv !== null) {
    agent = fromFlagOrEnv;
  } else if (opts.nonInteractive || !process.stdin.isTTY) {
    agent = NO_AGENT;
  } else if (events.onPhase) {
    // TUI is rendering — skip the readline prompt; assume the TUI handled
    // agent selection upstream and passed it via opts.agent. If still unset
    // here, default to NO_AGENT.
    agent = NO_AGENT;
  } else {
    agent = await promptForAgent();
  }

  events.onAgentResolved?.(agent);
  appendWatchLog(outDir, { event: 'agent-resolved', agent });

  // Detect + adapter
  events.onPhase?.('detecting');
  const detection = await detect(opts.url);
  events.onPlatformDetected?.(detection.platform, String(detection.confidence), detection.signals ?? []);
  const adapter = findAdapter(detection.platform);
  if (!adapter) {
    events.onError?.(`No adapter for platform: ${detection.platform}`);
    events.onPhase?.('error');
    appendWatchLog(outDir, { event: 'no-adapter', platform: detection.platform });
    return { ok: false, durationMs: Date.now() - start, processedUrls: 0, judgmentsHandled: 0, judgmentsSkipped: 0 };
  }

  // Kick off the preview in the background while inventory runs in
  // parallel. Both events fire independently — the TUI shows "Preview:"
  // when ready, and "Discovering URLs…" / "Found N URLs" alongside.
  ensureStubWxr(outDir);
  events.onPreviewStarting?.();
  let studioSitePath: string | null = null;
  let previewSource: 'studio' | null = null;
  const { startPreview } = await import('../lib/preview/studio.js');
  const previewPromise = startPreview({
    outputDir: outDir,
  })
    .then((stub) => {
      if (stub.status === 'ready' && stub.url) {
        previewSource = stub.source ?? 'studio';
        if (previewSource === 'studio' && stub.siteName) {
          const studioRoot = resolveStudioRoot();
          studioSitePath = join(studioRoot, stub.siteName);
        }
        events.onPreviewReady?.({
          url: stub.url,
          source: previewSource,
          siteName: stub.siteName,
        });
        appendWatchLog(outDir, {
          event: 'preview-pre-started',
          url: stub.url,
          source: stub.source,
          sitePath: studioSitePath,
        });
      } else {
        events.onPreviewFailed?.(stub.error ?? 'preview did not become ready');
        appendWatchLog(outDir, { event: 'preview-pre-start-failed', error: stub.error });
      }
    })
    .catch((err) => {
      events.onPreviewFailed?.((err as Error).message);
      appendWatchLog(outDir, { event: 'preview-pre-start-failed', error: (err as Error).message });
    });

  // Lock + discover in parallel with preview startup
  const log = new ExtractionLog(outDir);
  if (!log.acquireLock()) {
    events.onError?.('Another extraction is running in this outputDir');
    events.onPhase?.('error');
    await previewPromise;  // let the preview settle so we don't strand it
    return { ok: false, durationMs: Date.now() - start, processedUrls: 0, judgmentsHandled: 0, judgmentsSkipped: 0 };
  }

  // Block-fixer subprocess: persistent JSDOM + @wordpress/blocks registry,
  // canonicalizes composed markup before insert. Spawned now (in parallel
  // with detect + discover) so health-poll overlaps with extraction
  // setup; first compose flush won't typically fire for ~30s+ regardless
  // (foundation gate). If the subprocess can't start or the health-poll
  // times out, fix() falls back to passthrough — runner still installs,
  // just with un-normalized markup. Disable via DLA_BLOCK_FIXER=0.
  let blockFixer: BlockFixerClient | null = null;
  if (process.env.DLA_BLOCK_FIXER !== '0') {
    blockFixer = new BlockFixerClient((msg) =>
      appendWatchLog(outDir, { event: 'block-fixer-log', msg }),
    );
    void blockFixer.start().catch((err) =>
      appendWatchLog(outDir, { event: 'block-fixer-start-failed', error: (err as Error).message }),
    );
  }

  let processedUrls = 0;
  let judgmentsHandled = 0;
  let judgmentsSkipped = 0;
  // Homepage post ID captured during per-URL installs (html-first mode).
  // Set when an installed entry's archetype is 'homepage' and installPost
  // returns a valid post_id. Used at run-end to wire WP's static front page.
  let homepagePostId: number | null = null;
  const scheduler = createTickScheduler({ outputDir: outDir });
  const pendingImports = new PendingImportsBuffer(outDir);
  // Run-wide source URL → local upload URL map. Populated by per-URL
  // installMediaForUrl() calls; consumed by flushPendingImports when it
  // rewrites compose sidecars before insert. Accumulating across all
  // URLs (not per-URL) handles cross-page media references — e.g. an
  // archive page that shows thumbnails for assets installed during a
  // prior URL's extraction.
  const mediaUrlMap = new Map<string, string>();
  let judgments: JudgmentNeeded[] = [];
  const deferredFoundationJudgments: JudgmentNeeded[] = [];

  try {
    const adapterOpts = {
      token: opts.token,
      cdpPort: opts.cdpPort,
      adminToken: opts.adminToken,
      shopDomain: opts.shopDomain,
      delay: opts.delay,
      resume: opts.resume,
      limit: opts.limit ?? undefined,
      verbose: opts.verbose,
      outputDir: outDir,
    };

    events.onPhase?.('discovering');
    const inventory = (await adapter.discover(opts.url, adapterOpts)) as {
      siteMeta?: { title?: string; tagline?: string; language?: string };
      urls?: Array<{ url: string; type: string }>;
    };
    const sourceSiteMeta = {
      title: inventory.siteMeta?.title,
      tagline: inventory.siteMeta?.tagline,
      language: inventory.siteMeta?.language,
    };

    const wxr = new WxrBuilder({
      title: inventory.siteMeta?.title || 'Imported Site',
      url: opts.url,
      description: inventory.siteMeta?.tagline || '',
      language: inventory.siteMeta?.language || 'en-US',
    });

    const session = ImportSession.loadOrCreate(outDir, detection.platform, adapterOpts, { resume: opts.resume });

    events.onUrlsDiscovered?.((inventory.urls ?? []).length);
    // Per-archetype counts from the inventory — this is the breakdown the
    // user sees BEFORE extraction starts (matches the discover.tsx flow).
    const inventoryCounts: Record<string, number> = {};
    for (const u of inventory.urls ?? []) {
      inventoryCounts[u.type] = (inventoryCounts[u.type] || 0) + 1;
    }
    events.onInventoryCounts?.(inventoryCounts);
    appendWatchLog(outDir, { event: 'discovered', count: (inventory.urls ?? []).length, counts: inventoryCounts });

    // Adapter.extract requires an MCP `server` for log routing. CLI mode
    // doesn't have one; wire a stub that routes log messages through the
    // events callback (TUI renders) or stderr (plain text fallback).
    events.onPhase?.('extracting');
    const fakeServer = {
      sendLoggingMessage: (msg: { level: string; data: string }) => {
        if (events.onAdapterLog) events.onAdapterLog(msg.data);
        else if (opts.verbose) process.stderr.write(`  ${msg.data}\n`);
      },
    };

    // --limit caps the URL list before we start. Previously the cap was
    // applied inside runExtractionLoop; the new per-URL loop iterates
    // outside it so we have to apply the cap here.
    const allUrls = inventory.urls ?? [];
    const urls = (opts.limit !== null && opts.limit !== undefined && opts.limit >= 0)
      ? allUrls.slice(0, opts.limit)
      : allUrls;
    const totalUrls = urls.length;

    // Streaming screenshot → extraction pipeline. Screenshots and adapter
    // extraction both start immediately; the adapter runs once over the full
    // inventory and emits per-URL callbacks from runExtractionLoop. A small
    // worker waits until a URL has both extraction output and screenshot/html
    // artifacts before firing design ticks. Studio media/post installs drain
    // whenever the preview is ready, so preview boot no longer blocks fetching.
    events.onPhase?.('extracting');
    events.onAdapterLog?.(`capturing screenshots + html for ${totalUrls} URLs`);

    const extractedEvents = new Map<string, PageExtractedEvent>();
    const screenshotDoneUrls = new Set<string>();
    const readyQueue: PageExtractedEvent[] = [];
    const queuedReadyUrls = new Set<string>();
    const processedReadyUrls = new Set<string>();
    const pendingMediaInstallUrls = new Set<string>();
    let wakeStreamingWorker: (() => void) | null = null;
    let extractionDone = false;
    let screenshotsDone = false;
    let screenshotsUnavailable = false;
    let previewSettled = false;
    let studioDrainRequested = false;
    let siteOptionsApplied = false;
    let extractedHere = 0;
    // Populated by the screenshot promise when captureDesign=true and
    // captureScreenshots returns a siteCssPath. Used at run-end to assemble +
    // install the blank design theme.
    let designCaptureSiteCssPath: string | undefined;
    let designCaptureCssMediaUrls: string[] | undefined;
    let designCaptureHeadLinks: string[] | undefined;
    let designCaptureSiteJsText: string | undefined;
    let designCaptureNav: ExtractedNav | undefined;
    let designCaptureFooterHtml: string | undefined;
    let designCaptureChromeCssText: string | undefined;

    const wakeWorker = (): void => {
      if (wakeStreamingWorker) {
        const r = wakeStreamingWorker;
        wakeStreamingWorker = null;
        r();
      }
    };
    const waitForStreamingWork = (): Promise<void> =>
      new Promise<void>((r) => {
        wakeStreamingWorker = r;
      });
    const requestStudioDrain = (): void => {
      studioDrainRequested = true;
      wakeWorker();
    };
    const readyForDesignWork = (url: string): boolean =>
      previewSettled && (screenshotsUnavailable || screenshotsDone || screenshotDoneUrls.has(url));
    const enqueueReadyIfPossible = (url: string): void => {
      if (queuedReadyUrls.has(url) || processedReadyUrls.has(url)) return;
      if (!readyForDesignWork(url)) return;
      const event = extractedEvents.get(url);
      if (!event) return;
      queuedReadyUrls.add(url);
      readyQueue.push(event);
      wakeWorker();
    };
    const enqueueAllReady = (): void => {
      for (const url of extractedEvents.keys()) enqueueReadyIfPossible(url);
    };

    void previewPromise.then(() => {
      previewSettled = true;
      enqueueAllReady();
      requestStudioDrain();
      wakeWorker();
    });

    const drainStudioWork = async (): Promise<void> => {
      studioDrainRequested = false;
      if (!studioSitePath) return;
      let mediaInstallBlockedPostFlush = false;

      if (!siteOptionsApplied) {
        siteOptionsApplied = true;
        try {
          const { updateStudioSiteOptions } = await import('../lib/preview/studio.js');
          const warnings = await updateStudioSiteOptions(studioSitePath, sourceSiteMeta);
          appendWatchLog(outDir, {
            event: 'site-options-updated',
            title: sourceSiteMeta.title ?? null,
            tagline: sourceSiteMeta.tagline ?? null,
            warnings,
          });
        } catch (err) {
          appendWatchLog(outDir, {
            event: 'site-options-update-failed',
            error: (err as Error).message,
          });
        }
      }

      if (pendingMediaInstallUrls.size > 0) {
        const urlsToInstall = Array.from(pendingMediaInstallUrls);
        pendingMediaInstallUrls.clear();
        const { installMediaForUrl } = await import('../lib/streaming/media-install.js');
        const wpRoot = studioWpRoot(studioSitePath);
        try {
          if (!wpRoot) {
            throw new Error(`could not locate wp-content under Studio site path: ${studioSitePath}`);
          }
          const mediaResult = await installMediaForUrl({
            outputDir: outDir,
            url: urlsToInstall[0] ?? opts.url,
            wpRoot,
          });
          let added = 0;
          for (const entry of mediaResult.installed ?? []) {
            if (entry.sourceUrl && entry.localUrl) {
              mediaUrlMap.set(entry.sourceUrl, entry.localUrl);
              added += 1;
            }
          }
          appendWatchLog(outDir, {
            event: 'media-installed',
            url: urlsToInstall[0] ?? opts.url,
            pendingUrls: urlsToInstall.length,
            installed: added,
            mediaUrlMapSize: mediaUrlMap.size,
            errors: mediaResult.errors.length,
            errorSample: mediaResult.errors.slice(0, 5),
          });
          if (shouldHoldPostFlushForMediaInstall(mediaResult)) {
            mediaInstallBlockedPostFlush = true;
            for (const url of urlsToInstall) pendingMediaInstallUrls.add(url);
          }
        } catch (err) {
          mediaInstallBlockedPostFlush = true;
          for (const url of urlsToInstall) pendingMediaInstallUrls.add(url);
          appendWatchLog(outDir, {
            event: 'media-install-failed',
            url: urlsToInstall[0] ?? opts.url,
            pendingUrls: urlsToInstall.length,
            error: (err as Error).message,
          });
        }
      }

      const themePiecesPending = hasPendingThemePieces(outDir, !isNoAgent(agent));

      // Skip the recompose scaffold-theme install in html-first mode — the blank
      // theme assembled at run-end is the only theme. (Also guards against a stale
      // design-foundation.json from a prior recompose run triggering it.)
      if (!opts.captureDesign && existsSync(join(outDir, 'design-foundation.json')) && !themePiecesPending) {
        try {
          const r = await installScaffoldIfNeeded({
            outDir,
            studioSitePath,
            siteTitle: sourceSiteMeta.title,
            sourceUrl: opts.url,
            mediaUrlMap,
            events,
          });
          if (r.installed) {
            appendWatchLog(outDir, {
              event: 'theme-scaffold-installed',
              themeSlug: deriveThemeSlug(outDir),
              warnings: r.warnings ?? [],
            });
          }
        } catch (err) {
          appendWatchLog(outDir, { event: 'theme-scaffold-failed', error: (err as Error).message });
        }
      }

      if (themePiecesPending) {
        appendWatchLog(outDir, {
          event: 'pending-imports-held',
          reason: 'theme-pieces-pending',
          held: pendingImports.size(),
        });
        return;
      }

      if (mediaInstallBlockedPostFlush) {
        appendWatchLog(outDir, {
          event: 'pending-imports-held',
          reason: 'media-install-errors',
          held: pendingImports.size(),
        });
        return;
      }

      const flush = await flushPendingImports({
        buffer: pendingImports,
        outDir,
        studioSitePath,
        agent,
        events,
        mediaUrlMap,
        blockFixer,
        designCaptureActive: opts.captureDesign ?? false,
        onPostInstalled: (archetype, postId) => {
          if (archetype === 'homepage' && homepagePostId === null) {
            homepagePostId = postId;
          }
        },
      });
      if (flush.imported > 0 || flush.held > 0) {
        appendWatchLog(outDir, {
          event: 'pending-imports-flushed',
          imported: flush.imported,
          held: flush.held,
        });
      }
    };

    const processExtractedEvent = async (event: PageExtractedEvent): Promise<void> => {
      const archetype = event.type || classifyUrl(event.url);

      if (event.items.length > 0) {
        pendingMediaInstallUrls.add(event.url);
        requestStudioDrain();
      }
      for (const item of event.items) {
        if (item.type !== 'page' && item.type !== 'post') continue;
        pendingImports.enqueue({
          url: event.url,
          archetype,
          slug: item.slug,
          payload: item,
        });
        appendWatchLog(outDir, { event: 'post-queued', url: event.url, archetype });
      }

      if (studioSitePath && pendingMediaInstallUrls.size > 0) {
        requestStudioDrain();
        await drainStudioWork();
      }

      scheduler.observe(event.url, archetype);
      events.onUrlObserved?.(event.url, archetype);
      processedUrls += 1;

      const interleaved = await scheduler.drain();
      if (interleaved.length > 0) {
        const readyJudgments: JudgmentNeeded[] = [];
        for (const judgment of interleaved) {
          // html-first gate: skip the recompose path (foundation-rev /
          // theme-piece / archetype-template) when design capture is active.
          // The blank theme + design sidecars replace the replica-theme path;
          // running both would let two themes compete and cause compose to
          // fight the design fragment.
          if (opts.captureDesign && isRecomposeJudgment(judgment)) {
            appendWatchLog(outDir, {
              event: 'judgment-skipped',
              judgment,
              reason: 'html-first-design-capture-active',
            });
            judgmentsSkipped += 1;
            continue;
          }
          if (shouldDeferFoundationJudgment(judgment, outDir)) {
            deferredFoundationJudgments.push(judgment);
            appendWatchLog(outDir, {
              event: 'judgment-deferred',
              judgment,
              reason: 'foundation inputs unavailable',
            });
          } else {
            readyJudgments.push(judgment);
          }
        }
        const { handled, skipped } = await processJudgments(
          readyJudgments,
          agent,
          outDir,
          studioSitePath,
          events,
          (digest) => scheduler.recordFoundationInputsDigest(digest),
        );
        judgmentsHandled += handled;
        judgmentsSkipped += skipped;
      }

      requestStudioDrain();
    };

    const streamingWorker: Promise<void> = (async () => {
      while (true) {
        if (
          !hasPendingThemePieces(outDir, !isNoAgent(agent)) &&
          shouldPrioritizeThemeScaffoldDrain(outDir, studioSitePath, studioDrainRequested)
        ) {
          await drainStudioWork();
          continue;
        }
        if (readyQueue.length > 0) {
          const event = readyQueue.shift() as PageExtractedEvent;
          queuedReadyUrls.delete(event.url);
          processedReadyUrls.add(event.url);
          await processExtractedEvent(event);
          continue;
        }
        if (studioDrainRequested && studioSitePath) {
          await drainStudioWork();
          continue;
        }
        if (extractionDone && screenshotsDone && previewSettled) {
          if (studioSitePath) await drainStudioWork();
          break;
        }
        await waitForStreamingWork();
      }
    })();

    const screenshotPromise: Promise<void> = (async () => {
      try {
        if (totalUrls === 0) return;
        const { captureScreenshots } = await import('../lib/screenshot/screenshotter.js');
        try {
          const result = await captureScreenshots({
            urls: urls.map((u) => u.url),
            outputDir: outDir,
            concurrency: 6,
            server: fakeServer as never,
            captureDesign: opts.captureDesign ?? false,
            includeScripts: opts.includeScripts ?? false,
            onProgress: (current, total, url) => {
              events.onScreenshotProgress?.(current, total, url);
              screenshotDoneUrls.add(url);
              enqueueReadyIfPossible(url);
            },
          });
          if (result.siteCssPath) {
            designCaptureSiteCssPath = result.siteCssPath;
            designCaptureCssMediaUrls = result.cssMediaUrls ?? [];
            designCaptureHeadLinks = result.headLinks ?? [];
            designCaptureSiteJsText = result.siteJsText;
            designCaptureNav = result.nav;
            designCaptureFooterHtml = result.footerHtml;
            designCaptureChromeCssText = result.chromeCssText;
          }
          appendWatchLog(outDir, {
            event: 'screenshots-captured',
            captured: result.captured,
            failed: result.failed,
            skipped: result.skipped,
            durationMs: result.durationMs,
            ...(result.siteCssPath ? { designCssPath: result.siteCssPath } : {}),
          });
        } catch (err) {
          events.onAdapterLog?.(`screenshot capture failed: ${(err as Error).message}`);
          appendWatchLog(outDir, { event: 'screenshots-failed', error: (err as Error).message });
          screenshotsUnavailable = true;
          enqueueAllReady();
        }
      } finally {
        screenshotsDone = true;
        enqueueAllReady();
        wakeWorker();
      }
    })();

    const extractionWorker: Promise<void> = (async () => {
      try {
        await adapter.extract(
          { ...inventory, urls },
          wxr,
          {
            ...adapterOpts,
            onPageExtracted: (event: PageExtractedEvent) => {
              extractedHere += 1;
              events.onExtractionProgress?.(extractedHere, totalUrls, event.url);
              extractedEvents.set(event.url, event);
              enqueueReadyIfPossible(event.url);
              wakeWorker();
            },
          },
          { log, server: fakeServer as never },
        );
      } catch (err) {
        events.onAdapterLog?.(`extract failed: ${(err as Error).message}`);
        appendWatchLog(outDir, { event: 'extract-failed', error: (err as Error).message });
      } finally {
        extractionDone = true;
        enqueueAllReady();
        wakeWorker();
      }
    })();

    await Promise.all([screenshotPromise, extractionWorker, streamingWorker]);

    // Serialize the full WXR snapshot at the end (also acts as a checkpoint
    // for resume runs and for downstream tooling that reads output.wxr).
    if (wxr.items.length > 0) {
      wxr.serialize(join(outDir, 'output.wxr'));
    }

    // Final drain in case any judgments slipped through after the last URL.
    events.onPhase?.('tick-drain');
    let finalThemePieceAttempted = false;
    const maybePrependFinalThemePieces = (list: JudgmentNeeded[]): JudgmentNeeded[] => {
      // html-first gate: do not inject theme-piece judgments when design
      // capture is active — the blank theme assembly handles styling.
      if (opts.captureDesign) return list;
      if (finalThemePieceAttempted) return list;
      const next = maybePrependThemePieceJudgments(list, outDir, agent);
      if (next.some((j) => j.kind === 'theme-piece')) {
        finalThemePieceAttempted = true;
      }
      return next;
    };
    // html-first gate: filter recompose judgments before queueing.
    const filterForDesignMode = (list: JudgmentNeeded[]): JudgmentNeeded[] => {
      if (!opts.captureDesign) return list;
      const filtered = list.filter((j) => !isRecomposeJudgment(j));
      const skippedCount = list.length - filtered.length;
      if (skippedCount > 0) {
        appendWatchLog(outDir, {
          event: 'recompose-judgments-gated',
          count: skippedCount,
          reason: 'html-first-design-capture-active',
        });
        judgmentsSkipped += skippedCount;
      }
      return filtered;
    };
    const rawFinalJudgments = opts.captureDesign
      ? [...deferredFoundationJudgments, ...(await scheduler.drain())]
      : maybePrependThemePieceJudgments(
          ensureFinalFoundationJudgment(
            [...deferredFoundationJudgments, ...(await scheduler.drain())],
            outDir,
          ),
          outDir,
          agent,
        );
    judgments = filterForDesignMode(rawFinalJudgments);
    deferredFoundationJudgments.length = 0;
    events.onJudgmentsReady?.(judgments);
    appendWatchLog(outDir, { event: 'tick-drained', judgmentCount: judgments.length });

    while (judgments.length > 0) {
      events.onPhase?.('invoking-judgments');
      const { handled, skipped, themePieceAttempted } = await processJudgments(
        judgments,
        agent,
        outDir,
        studioSitePath,
        events,
        (digest) => scheduler.recordFoundationInputsDigest(digest),
      );
      judgmentsHandled += handled;
      judgmentsSkipped += skipped;
      finalThemePieceAttempted = finalThemePieceAttempted || themePieceAttempted;

      // A final foundation-rev can release archetype-template ticks that
      // were deferred while design-foundation.json was missing. Drain again
      // before cleanup so theme/template work does not get stranded after
      // the streaming worker has exited.
      judgments = maybePrependFinalThemePieces(await scheduler.drain());
      if (judgments.length > 0) {
        events.onJudgmentsReady?.(judgments);
        appendWatchLog(outDir, { event: 'tick-drained', judgmentCount: judgments.length, reason: 'post-judgment-follow-up' });
      }
    }

    // The final judgment loop may have created design-foundation.json after
    // the streaming worker already saw all URLs. Run one last Studio drain
    // while block-fixer/media maps are still alive so the scaffold can be
    // installed and pending pages can flush.
    if (studioSitePath) {
      requestStudioDrain();
      await drainStudioWork();
    }

    // html-first design theme assembly (run-end).
    // When captureDesign mode produced a site.css aggregate, assemble the
    // blank-theme bundle and install + activate it against the running Studio
    // site. This replaces the replica-theme scaffold for html-first runs:
    // the blank theme carries site.css (and site.js when --include-scripts is
    // active) and re-links CDN fonts/fonts instead of a block-theme scaffold.
    if (opts.captureDesign && designCaptureSiteCssPath && studioSitePath) {
      try {
        const wpRoot = studioWpRoot(studioSitePath);
        if (!wpRoot) {
          throw new Error(`could not locate wp-content under Studio site path: ${studioSitePath}`);
        }
        const { readFileSync: readSiteCss } = await import('node:fs');
        const cssText = readSiteCss(designCaptureSiteCssPath, 'utf8');

        // Upload CSS url() media (background images, fonts found in site.css) into
        // the WP media library so assembleDesignTheme can rewrite those URLs to
        // local ones. These URLs were never downloaded by the adapter path, so we
        // download them here, register them in MediaStubStore, and then call the
        // same installMediaForUrl helper used for per-URL <img> media.
        if (designCaptureCssMediaUrls && designCaptureCssMediaUrls.length > 0) {
          try {
            const { downloadMedia } = await import('../lib/media-fetch/index.js');
            const { MediaStubStore } = await import('../lib/resume-state/index.js');
            const { join: joinPath } = await import('node:path');
            const mediaDir = joinPath(outDir, 'media');
            const { mkdirSync: mkdirSyncFn } = await import('node:fs');
            mkdirSyncFn(mediaDir, { recursive: true });

            const stubs = MediaStubStore.load(outDir);
            const seenNames = new Map<string, number>();
            let cssMediaDownloaded = 0;
            let cssMediaErrors = 0;

            for (const cssUrl of designCaptureCssMediaUrls) {
              if (!stubs.shouldAttempt(cssUrl)) continue;
              try {
                const result = await downloadMedia(cssUrl, mediaDir, seenNames);
                if (result.localPath) {
                  stubs.markSuccess(cssUrl, result.localPath);
                  cssMediaDownloaded += 1;
                } else {
                  stubs.markFailure(cssUrl, result.error ?? 'unknown');
                  cssMediaErrors += 1;
                }
              } catch (dlErr) {
                stubs.markFailure(cssUrl, (dlErr as Error).message);
                cssMediaErrors += 1;
              }
            }
            stubs.flush();

            // Now install the newly downloaded CSS media into WP and merge into mediaUrlMap.
            const { installMediaForUrl } = await import('../lib/streaming/media-install.js');
            const cssMediaInstallResult = await installMediaForUrl({
              outputDir: outDir,
              url: opts.url,
              wpRoot,
            });
            let cssMediaInstalled = 0;
            for (const entry of cssMediaInstallResult.installed ?? []) {
              if (entry.sourceUrl && entry.localUrl) {
                mediaUrlMap.set(entry.sourceUrl, entry.localUrl);
                cssMediaInstalled += 1;
              }
            }
            appendWatchLog(outDir, {
              event: 'css-media-installed',
              total: designCaptureCssMediaUrls.length,
              downloaded: cssMediaDownloaded,
              downloadErrors: cssMediaErrors,
              installed: cssMediaInstalled,
              installErrors: cssMediaInstallResult.errors.length,
            });
          } catch (cssMediaErr) {
            appendWatchLog(outDir, {
              event: 'css-media-install-failed',
              error: (cssMediaErr as Error).message,
            });
          }
        }

        const designMediaUrlMap = new Map<string, string>();
        for (const [sourceUrl, localUrl] of mediaUrlMap.entries()) {
          if (localUrl) designMediaUrlMap.set(sourceUrl, localUrl);
        }

        const designThemeSlug = 'dla-replica';
        const themeFiles = assembleDesignTheme({
          outputDir: outDir,
          cssText,
          jsText: designCaptureSiteJsText,
          mediaUrlMap: designMediaUrlMap,
          headLinks: designCaptureHeadLinks ?? [],
          themeSlug: designThemeSlug,
          nav: designCaptureNav,
          footerHtml: designCaptureFooterHtml,
          chromeCssText: designCaptureChromeCssText,
          siteUrl: opts.url,
        });

        writeReplicaFilesToHost({ wpRoot, themeSlug: designThemeSlug, themeFiles });

        const warnings: string[] = [];
        try {
          const { stdout: _activateOut } = await execFileAsync(
            'studio',
            ['wp', '--path', studioSitePath, 'theme', 'activate', designThemeSlug],
            { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
          );
        } catch (err) {
          warnings.push(`Theme activate "${designThemeSlug}" failed: ${(err as Error).message.trim()}`);
        }

        // Wire the imported homepage as WP's static front page so the site
        // root serves the replica homepage instead of WP's default blog roll.
        if (homepagePostId !== null) {
          try {
            await execFileAsync(
              'studio',
              ['wp', '--path', studioSitePath, 'option', 'update', 'show_on_front', 'page'],
              { timeout: 30_000, maxBuffer: 1 * 1024 * 1024 },
            );
            await execFileAsync(
              'studio',
              ['wp', '--path', studioSitePath, 'option', 'update', 'page_on_front', String(homepagePostId)],
              { timeout: 30_000, maxBuffer: 1 * 1024 * 1024 },
            );
            appendWatchLog(outDir, { event: 'design-front-page-set', postId: homepagePostId });
          } catch (fpErr) {
            warnings.push(`Front-page set failed (post ${homepagePostId}): ${(fpErr as Error).message.trim()}`);
          }
        }

        appendWatchLog(outDir, {
          event: 'design-theme-installed',
          themeSlug: designThemeSlug,
          cssBytes: cssText.length,
          cssMediaUrls: (designCaptureCssMediaUrls ?? []).length,
          headLinksCount: (designCaptureHeadLinks ?? []).length,
          jsBytes: designCaptureSiteJsText ? designCaptureSiteJsText.length : 0,
          navItemCount: designCaptureNav ? designCaptureNav.items.length : 0,
          footerHtmlBytes: designCaptureFooterHtml ? designCaptureFooterHtml.length : 0,
          chromeCssBytes: designCaptureChromeCssText ? designCaptureChromeCssText.length : 0,
          warnings,
        });
      } catch (err) {
        appendWatchLog(outDir, {
          event: 'design-theme-install-failed',
          error: (err as Error).message,
        });
      }
    }
  } finally {
    log.releaseLock();
    if (blockFixer) {
      try {
        await blockFixer.stop();
        appendWatchLog(outDir, { event: 'block-fixer-stopped' });
      } catch (err) {
        appendWatchLog(outDir, { event: 'block-fixer-stop-failed', error: (err as Error).message });
      }
    }
  }

  // Post-extraction preview reconciliation.
  //
  // Studio mode: per-URL wp_insert_post already streamed every page into the
  // running site (with compose-page-blocks transforms applied via the
  // pending-imports flush). Re-booting Studio here would create a `-2`
  // duplicate site (makeStudioSiteName appends a suffix on collision) AND
  // re-import raw HTML from output.wxr on top of our composed blocks. So
  // we skip the second boot entirely; the user is already on the URL we
  // emitted at pre-start.
  //
  // Source-absent path: Studio was not running (previewSource is null/undefined),
  // so attempt another startPreview with the now-populated output.wxr. This
  // will fail if Studio is still unavailable — the error is surfaced via
  // onPreviewFailed rather than throwing.
  if (previewSource === 'studio') {
    appendWatchLog(outDir, {
      event: 'preview-reimport-skipped',
      reason: 'studio-streamed',
    });
  } else {
    events.onPhase?.('starting-preview');
    try {
      const { startPreview } = await import('../lib/preview/studio.js');
      const reimport = await startPreview({
        outputDir: outDir,
      });
      if (reimport.status === 'ready' && reimport.url) {
        events.onPreviewReady?.({
          url: reimport.url,
          source: reimport.source ?? 'studio',
          siteName: reimport.siteName,
        });
        appendWatchLog(outDir, {
          event: 'preview-reimported',
          url: reimport.url,
          source: reimport.source,
        });
      } else {
        events.onPreviewFailed?.(reimport.error ?? 'preview re-import did not become ready');
        appendWatchLog(outDir, { event: 'preview-reimport-failed', error: reimport.error });
      }
    } catch (err) {
      events.onPreviewFailed?.((err as Error).message);
      appendWatchLog(outDir, { event: 'preview-reimport-failed', error: (err as Error).message });
    }
  }

  events.onPhase?.('done');

  return {
    ok: true,
    durationMs: Date.now() - start,
    processedUrls,
    judgmentsHandled,
    judgmentsSkipped,
  };
}
