//
// liberate_ingest_local_site
// ==========================
// Stage 1a of the owned-source path: ingest a local static-site directory,
// normalize each page into native block markup (validated by the roundtrip
// oracle), and write composed sidecars + a normalize-report. No Playwright,
// no Studio. Downstream stages (theme-scaffold, install, compare) consume
// the composed sidecars.
//
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handler } from '../handler-types.js';
import { validateOutputDir } from '../../lib/screenshot/output-layout.js';
import { composedSidecarPath, instanceStylesPath } from '../../lib/streaming/block-markup-validate.js';
import { BlockFixerClient } from '../../lib/streaming/block-fixer-client.js';
import { ingestLocalSite } from '../../lib/replicate/local-site/ingest.js';
import { composePage } from '../../lib/replicate/normalize/compose-page.js';
import { makeIslandsEditable } from '../../lib/replicate/normalize/make-islands-editable.js';
import { InstanceStyleSheet } from '../../lib/replicate/normalize/instance-styles.js';
import { neutralizeStaticCards } from '../../lib/replicate/local-data/neutralize-static-cards.js';
import type { MountSpec } from '../../lib/replicate/local-data/types.js';
import {
  detectBehaviors,
  detectSectionBehavior,
  type BehaviorSourceAssets,
} from '../../lib/replicate/normalize/detect-behaviors.js';
import { collectSourceAssets } from '@automattic/blocks-engine/theme';
import type {
  NormalizeReportEntry,
  RevealBehavior,
  Section,
  SectionBehavior,
} from '../../lib/replicate/local-site/types.js';

// v2: the report envelope gained `stylingDrops` (styling-conservation diagnostic).
const NORMALIZE_REPORT_SCHEMA = 2;

export const ingestLocalSiteHandler: Handler = async (args, ctx) => {
  const dir = args.dir as string | undefined;
  const outputDir = (args.outputDir as string | undefined) ?? dir;
  const nativeBehaviors = args.nativeBehaviors === true;
  // Default ON: core/html islands convert to in-canvas dla/editable-html (visible + styled
  // in the editor). Opt OUT with editableIslands:false to force plain core/html.
  const editableIslands = args.editableIslands !== false;
  const cardMounts = (args.cardMounts as MountSpec[] | undefined) ?? [];
  if (!dir) return ctx.errorResult('dir is required');
  if (!outputDir) return ctx.errorResult('outputDir is required');
  try {
    validateOutputDir(outputDir);
  } catch (err) {
    return ctx.errorResult((err as Error).message);
  }

  let site;
  try {
    site = ingestLocalSite(dir);
  } catch (err) {
    return ctx.errorResult(`ingest failed: ${(err as Error).message}`);
  }

  // Per-section DOM-pattern detection runs on BOTH paths (pure + regex-fast):
  // a tagged section keeps its inner VERBATIM — content survival is path-
  // independent (carry E2E: emitChild destroyed tab/panel scaffolding and the
  // carried source JS had nothing to drive). `native` only decides the
  // WRAPPER: dla/<kind> directives (nativeBehaviors) vs a plain core/group.
  // reveal stays flag-gated — it changes visuals via the plugin, which the
  // carry path never installs. Detection consumes the RAW collected css —
  // assets.css has WP_COMPAT_CSS prepended, which is detection-immune (no
  // html.js section gate, no scroll-listener patterns). The convert handler
  // re-runs the same pure detection for sticky/gaps/plugin wiring —
  // identical inputs, identical result (deterministic).
  const assets = collectSourceAssets(dir, site.pages.map((p) => ({ relPath: p.relPath, html: p.html })));
  const assetSlice: BehaviorSourceAssets = { css: assets.css, js: assets.js };
  const detectSection = (s: Section): SectionBehavior | undefined => detectSectionBehavior(s.html, assetSlice);
  let reveal: RevealBehavior | undefined;
  if (nativeBehaviors) {
    reveal = detectBehaviors(assetSlice).reveal;
  }

  mkdirSync(join(outputDir, 'composed'), { recursive: true });

  const entries: Array<NormalizeReportEntry & { slug: string }> = [];
  const failedPages: Array<{ slug: string; error: string }> = [];
  const emptyPages: string[] = [];
  let formsConverted = 0;
  let islandsConverted = 0;
  // Warning-level block-contract issues (emitter-bug dial — see block-contract.ts).
  const contractIssues: Array<{ slug: string; code: string; blockName: string; detail: string }> = [];
  // Warning-level styling-conservation drops: source classes a section's block
  // conversion dropped (the carried CSS that targeted them no longer matches).
  const stylingDrops: Array<{ slug: string; sectionId: string; droppedClasses: string[] }> = [];

  // One sheet across all pages: per-element inline styles are carried as
  // lib-i<hash> classes (fixer-safe) + deduped stylesheet rules emitted to
  // composed/instance-styles.css, which the convert stage ships + enqueues on
  // BOTH the frontend and the editor canvas.
  const instanceStyles = new InstanceStyleSheet();

  // Canonicalize each page's composed markup through @wordpress/blocks (the
  // real block save() functions) before writing the sidecar, so the carried
  // blocks validate cleanly in the editor (no recovery / "unexpected content").
  // Best-effort: fix() passes the markup through unchanged if the sidecar can't
  // start — the markup is already emitted fixer-valid by construction.
  const blockFixer = new BlockFixerClient();
  await blockFixer.start().catch(() => {
    /* best-effort — fix() passes through if the server didn't start */
  });

  try {
    for (const page of site.pages) {
      // Per-page isolation: one bad page (roundtrip failure / compose misfit)
      // must not abort the whole ingest — record it and keep going.
      try {
        const pageCardMounts = cardMounts.filter((m) => !m.sourcePage || m.sourcePage === page.relPath);
        const neutralized = pageCardMounts.length > 0 ? neutralizeStaticCards(page.html, pageCardMounts) : undefined;
        const composeInput = neutralized?.stamped.length ? { ...page, html: neutralized.html } : page;
        const composed = composePage(composeInput, {
          reveal,
          detectSection,
          native: nativeBehaviors,
          // Internal .html hrefs in page bodies → /slug/ permalinks at emission.
          pageSlugs: site.pages.map((sp) => sp.slug),
          instanceStyles,
          // Carry fidelity: keep inline-svg icons (search magnifier, card/meta
          // glyphs), button menus, and empty CSS-background hooks verbatim —
          // the block conversion otherwise silently drops them. Query-loop
          // mounts are excluded (id-bearing), so the data path is unaffected.
          verbatimInteractive: true,
          jetpackForms: true,
        });
        formsConverted += composed.formsConverted;
        let { postContent } = composed;
        const { report } = composed;
        if (editableIslands) {
          const editable = makeIslandsEditable(postContent);
          postContent = editable.content;
          islandsConverted += editable.converted;
        }
        if (postContent === '' && report.length === 0) emptyPages.push(page.slug);
        const fixed = (await blockFixer.fix([postContent]))[0];
        const finalContent = fixed?.html ?? postContent;
        writeFileSync(composedSidecarPath(outputDir, page.slug), finalContent);
        for (const r of report) entries.push({ ...r, slug: page.slug });
        for (const issue of composed.contractIssues) contractIssues.push({ slug: page.slug, ...issue });
        for (const drop of composed.stylingDrops) stylingDrops.push({ slug: page.slug, ...drop });
      } catch (err) {
        failedPages.push({ slug: page.slug, error: (err as Error).message });
      }
    }
  } finally {
    await blockFixer.stop().catch(() => {
      /* best-effort cleanup */
    });
  }

  // Persist the carried instance-style rules (atomic tmp+rename) for the convert
  // stage. Always written (empty file when nothing was carried) so convert has a
  // deterministic read target; an empty sheet emits no rules.
  const instanceCssPath = instanceStylesPath(outputDir);
  const instanceCssTmp = `${instanceCssPath}.tmp.${process.pid}`;
  try {
    writeFileSync(instanceCssTmp, instanceStyles.toCss());
    renameSync(instanceCssTmp, instanceCssPath);
  } catch (err) {
    try { unlinkSync(instanceCssTmp); } catch { /* ignore */ }
    return ctx.errorResult(`failed to write instance-styles.css: ${(err as Error).message}`);
  }

  // Per-kind counts come from the compose REPORTS (single source of truth —
  // no re-detection drift), then the global detection RE-RUNS with the fired
  // kinds so their driver js is claimed out of the gap residue. The second
  // pass is pure + regex-fast and deterministic (same strings in → same
  // reveal/sticky out); only residue claiming differs, and sectionKinds can
  // only exist AFTER compose produced the reports — hence two passes.
  let behaviorsSummary:
    | { reveal: boolean; tabs: number; slider: number; modal: number; gaps: number }
    | undefined;
  if (nativeBehaviors) {
    const countOf = (kind: 'tabs' | 'slider' | 'modal'): number =>
      entries.filter((e) => e.blockType === `dla/${kind}`).length;
    const tabs = countOf('tabs');
    const slider = countOf('slider');
    const modal = countOf('modal');
    const sectionKinds = new Set<'tabs' | 'slider' | 'modal'>();
    if (tabs > 0) sectionKinds.add('tabs');
    if (slider > 0) sectionKinds.add('slider');
    if (modal > 0) sectionKinds.add('modal');
    const final = detectBehaviors(assetSlice, { sectionKinds });
    behaviorsSummary = { reveal: !!final.reveal, tabs, slider, modal, gaps: final.gaps.length };
  }

  // Atomic write (tmp + rename) — a crash mid-write must not leave a torn
  // normalize-report.json behind. The composed/ recursive mkdir above already
  // guarantees outputDir exists.
  const reportPath = join(outputDir, 'normalize-report.json');
  const tmpPath = `${reportPath}.tmp.${process.pid}`;
  try {
    writeFileSync(
      tmpPath,
      JSON.stringify({ schema: NORMALIZE_REPORT_SCHEMA, site: dir, entries, failedPages, emptyPages, contractIssues, stylingDrops }, null, 2),
    );
    renameSync(tmpPath, reportPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    return ctx.errorResult(`failed to write normalize-report: ${(err as Error).message}`);
  }

  return ctx.textResult({
    pages: site.pages.length,
    sections: entries.length,
    lowConfidence: entries.filter((e) => e.confidence < 1).length,
    failedPageCount: failedPages.length,
    failedPagesList: failedPages,
    emptyPages,
    reportPath,
    contractIssues: contractIssues.length,
    // Styling-conservation: sections whose conversion dropped a source class
    // (detail in normalize-report.json). 0 = every source class survived.
    stylingDrops: stylingDrops.length,
    formsConverted,
    ...(editableIslands ? { islandsConverted } : {}),
    // Per-instance inline styles carried as lib-i classes + rules (editor-valid).
    instanceStyleRules: instanceStyles.size,
    // Standalone observability (key absent when the flag is off): what
    // detection found + per-kind section counts from the compose reports.
    // No artifact write here — behavior-gaps.json belongs to the convert stage.
    ...(behaviorsSummary !== undefined ? { behaviors: behaviorsSummary } : {}),
  });
};
