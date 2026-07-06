//
// SiteAnalysisAggregator
// ======================
// Accumulates per-URL PageAnalysis results into three per-site files:
//
//   output/<site>/palette.json       — dominant colors ranked by urls desc
//   output/<site>/typography.json    — font metrics per selector, deduped
//   output/<site>/breakpoints.json   — @media min/max-width union, sorted
//
// Used by the screenshotter: add() is called from inside capturePerViewport
// (desktop only) after analyzePage returns; serialize() is called in the
// top-level finally block, atomically writing all three files.
//
// Resume semantics: init() loads any existing aggregated files and merges
// new per-URL data into them. sampledUrls tracks the union across runs,
// not just this run.
//
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { PageAnalysis } from './site-analysis.js';

export interface PaletteEntry {
  hex: string;
  count: number;
  urls: number;
}

export interface TypographyEntry {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  urls: number;
}

export interface ComputedStyleEntry {
  color: string;
  backgroundColor: string;
  borderColor: string;
  borderRadius: string;
  backgroundImage: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  padding?: string;
  textTransform?: string;
  urls: number;
}

export interface PaletteFile {
  version: 1;
  sampledUrls: number;
  colors: PaletteEntry[];
}

export interface TypographyFile {
  version: 1;
  sampledUrls: number;
  bySelector: Record<string, TypographyEntry[]>;
}

export interface BreakpointsFile {
  version: 1;
  sampledUrls: number;
  minWidth: number[];
  maxWidth: number[];
}

export interface ComputedStylesFile {
  version: 1;
  sampledUrls: number;
  bySelector: Record<string, ComputedStyleEntry[]>;
}

export interface CssVariableEntry {
  name: string;
  value: string;
  isColor: boolean;
  urls: number;
}

export interface CssVariablesFile {
  version: 1;
  sampledUrls: number;
  variables: CssVariableEntry[];
}

const PALETTE_LIMIT = 24;
const PALETTE_FILE = 'palette.json';
const TYPOGRAPHY_FILE = 'typography.json';
const BREAKPOINTS_FILE = 'breakpoints.json';
const COMPUTED_STYLES_FILE = 'computed-styles.json';
const CSS_VARIABLES_FILE = 'css-variables.json';

/**
 * Aggregates PageAnalysis results from many URLs into three site-level files.
 *
 * Call add(url, analysis) per URL, then serialize(outputDir) at run end.
 * Safe to call serialize() multiple times (idempotent atomic rewrites).
 */
export class SiteAnalysisAggregator {
  // hex -> { count: total pixel-count across all URLs; urls: distinct URL count }
  private paletteByHex: Map<string, { count: number; urls: Set<string> }> = new Map();
  // selector -> (canonical tuple key -> urls Set)
  private typoBySelector: Map<string, Map<string, { tuple: Omit<TypographyEntry, 'urls'>; urls: Set<string> }>> = new Map();
  // selector -> (canonical style tuple key -> urls Set)
  private computedBySelector: Map<string, Map<string, { tuple: Omit<ComputedStyleEntry, 'urls'>; urls: Set<string> }>> = new Map();
  // union of integer px breakpoints
  private minWidth: Set<number> = new Set();
  private maxWidth: Set<number> = new Set();
  // custom-property name -> { latest value, isColor, distinct URL count }
  private cssVarsByName: Map<string, { value: string; isColor: boolean; urls: Set<string> }> = new Map();
  // distinct URLs that contributed to aggregation
  private sampledUrls: Set<string> = new Set();

  /** Load existing aggregated files from outputDir, if present. */
  init(outputDir: string): void {
    const palettePath = join(outputDir, PALETTE_FILE);
    if (existsSync(palettePath)) {
      try {
        const parsed = JSON.parse(readFileSync(palettePath, 'utf8')) as PaletteFile;
        if (parsed.version === 1 && Array.isArray(parsed.colors)) {
          for (const c of parsed.colors) {
            // We don't have the original URL list; seed with a placeholder so
            // merged counts still reflect that those URLs contributed. The
            // sampledUrls count still round-trips.
            this.paletteByHex.set(c.hex, {
              count: c.count,
              urls: new Set<string>(Array.from({ length: c.urls }, (_, i) => `__prior_run__${c.hex}_${i}`)),
            });
          }
        }
      } catch { /* corrupt — start fresh */ }
    }

    const typoPath = join(outputDir, TYPOGRAPHY_FILE);
    if (existsSync(typoPath)) {
      try {
        const parsed = JSON.parse(readFileSync(typoPath, 'utf8')) as TypographyFile;
        if (parsed.version === 1 && parsed.bySelector) {
          for (const [sel, entries] of Object.entries(parsed.bySelector)) {
            const selMap = new Map<string, { tuple: Omit<TypographyEntry, 'urls'>; urls: Set<string> }>();
            for (const e of entries) {
              const tuple = { fontFamily: e.fontFamily, fontSize: e.fontSize, fontWeight: e.fontWeight, lineHeight: e.lineHeight };
              selMap.set(keyForTypographyTuple(tuple), {
                tuple,
                urls: new Set<string>(Array.from({ length: e.urls }, (_, i) => `__prior_run__${sel}_${i}`)),
              });
            }
            this.typoBySelector.set(sel, selMap);
          }
        }
      } catch { /* corrupt — start fresh */ }
    }

    const bpPath = join(outputDir, BREAKPOINTS_FILE);
    if (existsSync(bpPath)) {
      try {
        const parsed = JSON.parse(readFileSync(bpPath, 'utf8')) as BreakpointsFile;
        if (parsed.version === 1) {
          for (const n of parsed.minWidth ?? []) this.minWidth.add(n);
          for (const n of parsed.maxWidth ?? []) this.maxWidth.add(n);
          // sampledUrls seed — used in union below
          for (let i = 0; i < (parsed.sampledUrls ?? 0); i++) {
            this.sampledUrls.add(`__prior_run__bp_${i}`);
          }
        }
      } catch { /* corrupt */ }
    }

    const cssVarsPath = join(outputDir, CSS_VARIABLES_FILE);
    if (existsSync(cssVarsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(cssVarsPath, 'utf8')) as CssVariablesFile;
        if (parsed.version === 1 && Array.isArray(parsed.variables)) {
          for (const v of parsed.variables) {
            this.cssVarsByName.set(v.name, {
              value: v.value,
              isColor: v.isColor,
              urls: new Set<string>(Array.from({ length: v.urls }, (_, i) => `__prior_run__cssvar_${v.name}_${i}`)),
            });
          }
        }
      } catch { /* corrupt — start fresh */ }
    }

    const computedPath = join(outputDir, COMPUTED_STYLES_FILE);
    if (existsSync(computedPath)) {
      try {
        const parsed = JSON.parse(readFileSync(computedPath, 'utf8')) as ComputedStylesFile;
        if (parsed.version === 1 && parsed.bySelector) {
          for (const [sel, entries] of Object.entries(parsed.bySelector)) {
            const selMap = new Map<string, { tuple: Omit<ComputedStyleEntry, 'urls'>; urls: Set<string> }>();
            for (const e of entries) {
              const { urls: _urls, ...tuple } = e;
              selMap.set(keyForComputedStyleTuple(tuple), {
                tuple,
                urls: new Set<string>(Array.from({ length: e.urls }, (_, i) => `__prior_run__computed_${sel}_${i}`)),
              });
            }
            this.computedBySelector.set(sel, selMap);
          }
        }
      } catch { /* corrupt */ }
    }
  }

  /**
   * Add one URL's analysis to the aggregation. Called once per URL, not
   * per viewport — the desktop pass is the canonical source.
   */
  add(url: string, analysis: PageAnalysis): void {
    this.sampledUrls.add(url);

    for (const p of analysis.palette) {
      let entry = this.paletteByHex.get(p.hex);
      if (!entry) {
        entry = { count: 0, urls: new Set() };
        this.paletteByHex.set(p.hex, entry);
      }
      entry.count += p.count;
      entry.urls.add(url);
    }

    for (const [selector, tuple] of Object.entries(analysis.typography)) {
      let selMap = this.typoBySelector.get(selector);
      if (!selMap) {
        selMap = new Map();
        this.typoBySelector.set(selector, selMap);
      }
      const key = keyForTypographyTuple(tuple);
      let record = selMap.get(key);
      if (!record) {
        record = { tuple, urls: new Set() };
        selMap.set(key, record);
      }
      record.urls.add(url);
    }

    for (const [selector, tuple] of Object.entries(analysis.computedStyles ?? {})) {
      let selMap = this.computedBySelector.get(selector);
      if (!selMap) {
        selMap = new Map();
        this.computedBySelector.set(selector, selMap);
      }
      const key = keyForComputedStyleTuple(tuple);
      let record = selMap.get(key);
      if (!record) {
        record = { tuple, urls: new Set() };
        selMap.set(key, record);
      }
      record.urls.add(url);
    }

    for (const n of analysis.breakpoints.minWidth) this.minWidth.add(n);
    for (const n of analysis.breakpoints.maxWidth) this.maxWidth.add(n);

    for (const v of analysis.cssVariables ?? []) {
      let entry = this.cssVarsByName.get(v.name);
      if (!entry) {
        entry = { value: v.value, isColor: v.isColor, urls: new Set() };
        this.cssVarsByName.set(v.name, entry);
      } else {
        // Keep the most recent non-empty value; a token rarely changes value
        // across pages, but a later page's literal wins over an empty earlier one.
        if (v.value) {
          entry.value = v.value;
          entry.isColor = v.isColor;
        }
      }
      entry.urls.add(url);
    }
  }

  hasSamples(): boolean {
    return this.sampledUrls.size > 0;
  }

  /** Serialize all three files to outputDir via tmp + atomic rename. */
  serialize(outputDir: string): void {
    mkdirSync(outputDir, { recursive: true });

    const palette = this._buildPaletteFile();
    const typography = this._buildTypographyFile();
    const breakpoints = this._buildBreakpointsFile();
    const computedStyles = this._buildComputedStylesFile();
    const cssVariables = this._buildCssVariablesFile();

    writeAtomic(join(outputDir, PALETTE_FILE), JSON.stringify(palette, null, 2));
    writeAtomic(join(outputDir, TYPOGRAPHY_FILE), JSON.stringify(typography, null, 2));
    writeAtomic(join(outputDir, BREAKPOINTS_FILE), JSON.stringify(breakpoints, null, 2));
    writeAtomic(join(outputDir, COMPUTED_STYLES_FILE), JSON.stringify(computedStyles, null, 2));
    writeAtomic(join(outputDir, CSS_VARIABLES_FILE), JSON.stringify(cssVariables, null, 2));
  }

  private _buildPaletteFile(): PaletteFile {
    const colors: PaletteEntry[] = Array.from(this.paletteByHex.entries())
      .map(([hex, { count, urls }]) => ({ hex, count, urls: urls.size }))
      .sort((a, b) => {
        if (b.urls !== a.urls) return b.urls - a.urls;
        return b.count - a.count;
      })
      .slice(0, PALETTE_LIMIT);

    return { version: 1, sampledUrls: this.sampledUrls.size, colors };
  }

  private _buildTypographyFile(): TypographyFile {
    const bySelector: Record<string, TypographyEntry[]> = {};
    for (const [selector, selMap] of this.typoBySelector.entries()) {
      const entries: TypographyEntry[] = Array.from(selMap.values())
        .map(({ tuple, urls }) => ({ ...tuple, urls: urls.size }))
        .sort((a, b) => b.urls - a.urls);
      bySelector[selector] = entries;
    }
    return { version: 1, sampledUrls: this.sampledUrls.size, bySelector };
  }

  private _buildBreakpointsFile(): BreakpointsFile {
    return {
      version: 1,
      sampledUrls: this.sampledUrls.size,
      minWidth: Array.from(this.minWidth).sort((a, b) => a - b),
      maxWidth: Array.from(this.maxWidth).sort((a, b) => a - b),
    };
  }

  private _buildComputedStylesFile(): ComputedStylesFile {
    const bySelector: Record<string, ComputedStyleEntry[]> = {};
    for (const [selector, selMap] of this.computedBySelector.entries()) {
      const entries: ComputedStyleEntry[] = Array.from(selMap.values())
        .map(({ tuple, urls }) => ({ ...tuple, urls: urls.size }))
        .sort((a, b) => b.urls - a.urls);
      bySelector[selector] = entries;
    }
    return { version: 1, sampledUrls: this.sampledUrls.size, bySelector };
  }

  private _buildCssVariablesFile(): CssVariablesFile {
    const variables: CssVariableEntry[] = Array.from(this.cssVarsByName.entries())
      .map(([name, { value, isColor, urls }]) => ({ name, value, isColor, urls: urls.size }))
      .sort((a, b) => {
        if (b.urls !== a.urls) return b.urls - a.urls;
        return a.name.localeCompare(b.name);
      });
    return { version: 1, sampledUrls: this.sampledUrls.size, variables };
  }
}

function keyForTypographyTuple(t: Omit<TypographyEntry, 'urls'>): string {
  return `${t.fontFamily}|${t.fontSize}|${t.fontWeight}|${t.lineHeight}`;
}

function keyForComputedStyleTuple(t: Omit<ComputedStyleEntry, 'urls'>): string {
  const keys = Object.keys(t).sort() as Array<keyof Omit<ComputedStyleEntry, 'urls'>>;
  return JSON.stringify(keys.map((key) => [key, t[key] ?? '']));
}

function writeAtomic(path: string, content: string): void {
  const tmp = path + '.tmp';
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}
