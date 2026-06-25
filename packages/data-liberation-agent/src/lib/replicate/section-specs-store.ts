// src/lib/replicate/section-specs-store.ts
//
// Persists captured per-page section specs to disk so reconstruction can read
// them instead of re-running Playwright. The screenshot/capture phase already
// opens a settled page per URL; persisting `extractFull`'s output there means the
// reconstruction phase does NOT need a second browser pass — it reads the specs
// from `<outputDir>/sections/<slug>.json` (falling back to a live extract only
// when the cache is absent, stale, or a slug collides).
//
// WHY A NEW RESUME-STATE ARTIFACT
// Section specs are the heavyweight product of a Playwright + getComputedStyle
// walk. Today they're recomputed live every reconstruction run and discarded —
// a redundant second pass over every URL. Capturing them once (during the same
// pass that takes screenshots) and persisting them makes reconstruction fast,
// offline, and re-runnable without re-hitting the source — consistent with the
// other capture-once resume-state files (extraction-log, session.json,
// media-stubs.json, products.jsonl).
//
// LAYOUT
// One self-describing file per source URL, keyed by `slugify(url)` so it sits
// next to `html/<slug>.html` and `screenshots/<viewport>/<slug>.png` for the same
// page. The file records its own `sourceUrl`, so a slug COLLISION between two
// URLs is detected on read (mismatch → cache miss → live re-extract) rather than
// silently serving the wrong page's specs. Writes are atomic (tmp + rename).

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { slugify } from '../url/index.js';
import type { SectionSpec, SourceLandmark } from './section-extract.js';

/**
 * Bump when `SectionSpec`'s shape changes in a way that affects reconstruction.
 * A file written under an older schema is treated as a cache MISS (→ live
 * re-extract + rewrite), so a stale cache never silently degrades fidelity.
 */
// v4: heading capture is full verbatim text at the source heading size, and a
// paragraph that repeats a heading is NO LONGER deduped — the source genuinely
// shows both a subheading and an identical paragraph, so reproducing both is
// faithful. Capture-semantics change → invalidate older caches and re-extract.
// v5: sections now persist `sectionHtml` (capped) for the coverage-gated
// core/html verbatim fallback. Older caches lack it → invalidate + re-extract.
// v6: sections now persist `styledHtml` (capped) — a computed-style-inlined
// snapshot powering the R4b deterministic styled-island floor. Older caches lack
// it → invalidate + re-extract so the floor renders styled, not bare.
// v7: + SectionSpec.selector and a landmarks census (region audit #2)
// v8: + SectionSpec.forms[] capture (recognized source form fields + submit
// label, classified by buildSectionForms) — powers the jetpack/contact-form
// emission. Older caches lack it → invalidate + re-extract.
// v9: SourceLandmark adds aside/complementary roles and optional linkCount.
export const SECTION_SPECS_SCHEMA = 9;

interface SectionSpecsFile {
  schema: number;
  sourceUrl: string;
  capturedAt: string;
  /** Viewport the specs were captured at — geometry/fullBleed are viewport-
   *  relative, so this records the basis for the capture (desktop 1440×900). */
  viewport: { width: number; height: number };
  sections: SectionSpec[];
  /** Top-level source landmarks captured in the same walk (region audit #2). */
  landmarks: SourceLandmark[];
}

/**
 * Reads/writes per-URL section specs under `<outputDir>/sections/`. Each URL maps
 * to its own file, so pages are independent (no shared mutable index, no single-
 * writer hazard between the capture and reconstruction phases).
 */
export class SectionSpecsStore {
  readonly dir: string;

  private constructor(dir: string) {
    this.dir = dir;
  }

  static load(outputDir: string): SectionSpecsStore {
    return new SectionSpecsStore(join(outputDir, 'sections'));
  }

  /** Absolute path of the spec file for a URL (keyed by slugify(url)). */
  pathFor(sourceUrl: string): string {
    return join(this.dir, `${slugify(sourceUrl)}.json`);
  }

  /** True when a usable (current-schema, matching-URL) cache exists for the URL. */
  has(sourceUrl: string): boolean {
    return this.get(sourceUrl) !== null;
  }

  /**
   * Return the cached specs for a URL, or `null` on any miss: file absent,
   * unreadable/corrupt, written under an older schema, or recorded against a
   * different `sourceUrl` (slug collision). A null return means "re-extract".
   */
  get(sourceUrl: string): SectionSpec[] | null {
    const p = this.pathFor(sourceUrl);
    if (!existsSync(p)) return null;
    try {
      const f = JSON.parse(readFileSync(p, 'utf8')) as SectionSpecsFile;
      if (f.schema !== SECTION_SPECS_SCHEMA) return null;
      if (f.sourceUrl !== sourceUrl) return null; // slug collision → not our page
      if (!Array.isArray(f.sections)) return null;
      return f.sections;
    } catch {
      return null; // corrupt — caller re-extracts and overwrites
    }
  }

  /** Persist a URL's specs atomically (tmp + rename). */
  set(
    sourceUrl: string,
    sections: SectionSpec[],
    landmarks: SourceLandmark[],
    viewport: { width: number; height: number } = { width: 1440, height: 900 },
  ): void {
    const file: SectionSpecsFile = {
      schema: SECTION_SPECS_SCHEMA,
      sourceUrl,
      capturedAt: new Date().toISOString(),
      viewport,
      sections,
      landmarks,
    };
    const p = this.pathFor(sourceUrl);
    mkdirSync(dirname(p), { recursive: true });
    // Unique tmp per write: the capture phase writes concurrently (batched URLs),
    // and two URLs that slugify to the same name would otherwise race a shared
    // `<slug>.json.tmp`. The rename stays atomic; last writer wins the final file
    // (always valid JSON), and reconstruction's sourceUrl guard sorts out which.
    const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(tmp, JSON.stringify(file));
    renameSync(tmp, p);
  }

  /** Cached landmark census for a URL, or `null` on any miss (same rules as get()). */
  getLandmarks(sourceUrl: string): SourceLandmark[] | null {
    const p = this.pathFor(sourceUrl);
    if (!existsSync(p)) return null;
    try {
      const f = JSON.parse(readFileSync(p, 'utf8')) as SectionSpecsFile;
      if (f.schema !== SECTION_SPECS_SCHEMA) return null;
      if (f.sourceUrl !== sourceUrl) return null;
      return Array.isArray(f.landmarks) ? f.landmarks : [];
    } catch {
      return null;
    }
  }
}
