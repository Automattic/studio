import { normalize } from 'node:path';

import type {
  FoundationAggregates,
  FoundationTokens,
  Section as EngineSection,
  StickyBehavior,
  ThemeBuildResult,
  ThemeModel,
} from '@automattic/blocks-engine/theme';
import {
  buildCarriedHeaderPart as buildEngineCarriedHeaderPart,
  buildFooterPart as buildEngineFooterPart,
  buildHeaderPart as buildEngineHeaderPart,
  findChromeMounts as findEngineChromeMounts,
  mountPartMarkup as engineMountPartMarkup,
  segmentPage,
} from '@automattic/blocks-engine/theme';
import type { ReplicaFile } from '../../preview/types.js';
import type { LocalSite } from '../local-site/types.js';
import {
  assembleLocalTheme,
  type CarrySourceAssets,
} from './theme-files.js';
import { buildCarriedSidebarPart } from './chrome-parts.js';
import type { InteriorChromeTemplate } from './interior-chrome.js';
import {
  buildLocalFoundation,
  extractCssColors,
  type BreakpointsAgg,
  type CssColorCount,
  type PaletteAgg,
  type TypographyAgg,
} from './foundation.js';

type TokenValue = { value?: string | null };

export interface DlaFoundationInput {
  palette?: PaletteAgg;
  typography?: TypographyAgg;
  breakpoints?: BreakpointsAgg;
  cssSources?: string[];
  cssColors?: CssColorCount[];
}

export interface EngineFoundationTranslation {
  foundationAggregates: FoundationAggregates;
  tokens: FoundationTokens;
}

export interface DlaFunctionsPhpOptions {
  siteTitle: string;
  themeSlug: string;
  carrySourceAssets?: CarrySourceAssets;
  instanceStylesCss?: string;
  jetpackFormParityCss?: string;
  bodyDataByPath?: Record<string, Record<string, string>>;
}

export interface EngineThemeHostFiles {
  themeFiles: ReplicaFile[];
  assetSourceDir: string;
  assetFiles: string[];
  writtenThemeFiles: string[];
}

export interface DlaLocalPageThemeOptions {
  site?: LocalSite;
  siteTitle: string;
  themeSlug: string;
  mainClass?: string;
  mainWrapperClass?: string;
  interiorChromeTemplates?: InteriorChromeTemplate[];
  carrySourceAssets?: CarrySourceAssets;
  instanceStylesCss?: string;
  jetpackFormParityCss?: string;
  sticky?: StickyBehavior;
  allowSourceChromeMounts?: boolean;
}

type LayoutRailSection = EngineSection & {
  layoutWrapperTag?: string;
  layoutWrapperClasses?: string[];
  layoutWrapperRailPosition?: 'beforeMain' | 'afterMain';
};

export function translateDlaFoundationToEngine(input: DlaFoundationInput): EngineFoundationTranslation {
  const cssColors = input.cssColors ?? (input.cssSources ? extractCssColors(input.cssSources) : undefined);
  const local = buildLocalFoundation(
    {
      palette: input.palette ?? emptyPalette(),
      typography: input.typography ?? emptyTypography(),
      breakpoints: input.breakpoints ?? emptyBreakpoints(),
    },
    cssColors ? { cssColors } : undefined,
  );
  const foundation = local.foundation;
  const palette = [
    paletteToken('Surface Base', foundation.color?.surface?.base),
    paletteToken('Surface Inverse', foundation.color?.surface?.inverse),
    paletteToken('Text Default', foundation.color?.text?.default),
    paletteToken('Text Inverse', foundation.color?.text?.inverse),
    paletteToken('Accent Primary', foundation.color?.accent?.primary),
  ].filter((entry): entry is FoundationTokens['palette'][number] => entry !== null);
  const tokens: FoundationTokens = {
    palette,
    typography: {
      ...stringProp('body', foundation.typography?.families?.body?.value),
      ...stringProp('display', foundation.typography?.families?.display?.value),
    },
    breakpoints: {
      ...stringProp('md', foundation.breakpoints?.md),
      ...stringProp('lg', foundation.breakpoints?.lg),
      ...stringProp('xl', foundation.breakpoints?.xl),
    },
  };

  return {
    tokens,
    foundationAggregates: {
      palette: tokens.palette,
      typography: tokens.typography,
      breakpoints: tokens.breakpoints,
    },
  };
}

export function buildDlaFunctionsPhpContent(options: DlaFunctionsPhpOptions): string {
  const file = assembleLocalTheme({
    siteTitle: options.siteTitle,
    themeSlug: options.themeSlug,
    headerPart: '',
    footerPart: '',
    carrySourceAssets: options.carrySourceAssets,
    instanceStylesCss: options.instanceStylesCss,
    jetpackFormParityCss: options.jetpackFormParityCss,
    bodyDataByPath: options.bodyDataByPath,
  }).find((candidate) => candidate.relativePath === 'functions.php');

  if (!file) throw new Error('DLA theme assembly did not emit functions.php');
  return file.content;
}

export function buildDlaInteriorChromeTemplates(site: LocalSite, homeSlug: string): Map<string, InteriorChromeTemplate> {
  const pageSlugs = site.pages.map((p) => p.slug);
  const out = new Map<string, InteriorChromeTemplate>();

  for (const page of site.pages) {
    if (page.slug === homeSlug) continue;
    const rails = segmentPage(page.html).filter((s) => s.chromeSource === 'layout-rail') as LayoutRailSection[];
    if (rails.length === 0) continue;

    const templateSlug = page.slug.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'page';
    const partMarkup = rails.map((rail) => buildCarriedSidebarPart(rail, { pageSlugs })).join('\n');
    const layoutWrapperRail = rails.find((rail) => rail.layoutWrapperTag && rail.layoutWrapperRailPosition);
    out.set(page.slug, {
      templateName: `page-local-${templateSlug}-chrome`,
      templateTitle: `Local Page Chrome (${page.title || page.slug})`,
      partSlug: `interior-chrome-${templateSlug}`,
      partMarkup,
      ...(layoutWrapperRail
        ? {
            layoutWrapperTag: layoutWrapperRail.layoutWrapperTag,
            layoutWrapperClasses: layoutWrapperRail.layoutWrapperClasses ?? [],
            layoutWrapperRailPosition: layoutWrapperRail.layoutWrapperRailPosition,
          }
        : {}),
    });
  }

  return out;
}

export function localThemeAuditSections(html: string): EngineSection[] {
  return segmentPage(html);
}

export async function refineEngineThemeForDlaLocalPages(theme: ThemeModel, options: DlaLocalPageThemeOptions): Promise<ThemeModel> {
  const dlaFiles = buildDlaLocalThemeFiles(options);
  const templates = { ...theme.templates };
  const parts = { ...theme.parts };
  let themeJson = theme.themeJson;

  for (const file of dlaFiles) {
    if (file.relativePath === 'theme.json') {
      const parsed = JSON.parse(file.content) as { customTemplates?: unknown };
      themeJson = mergeThemeJson(themeJson, parsed, options);
      continue;
    }
    if (file.relativePath.startsWith('templates/')) {
      const key = file.relativePath.slice('templates/'.length);
      if (key === 'front-page.html' || key === 'page-local.html' || /^page-local-.+-chrome\.html$/.test(key)) {
        templates[key] = file.content;
      }
      continue;
    }
    if (file.relativePath.startsWith('parts/interior-chrome-')) {
      parts[file.relativePath.slice('parts/'.length)] = file.content;
    }
  }

  return refineHomeChromeFallback({
    ...theme,
    themeJson,
    templates,
    parts,
  }, options);
}

export function buildDlaThemeSupplementFiles(options: DlaLocalPageThemeOptions): ReplicaFile[] {
  return buildDlaLocalThemeFiles(options).filter((file) => file.relativePath.startsWith('assets/'));
}

export function engineThemeResultToHostFiles(
  result: Pick<ThemeBuildResult, 'outDir' | 'model' | 'written'>,
  options: { functionsPhp: string; extraThemeFiles?: ReplicaFile[] },
): EngineThemeHostFiles {
  const themeFiles = dedupeThemeFiles([
    { relativePath: 'style.css', content: result.model.styleCss },
    { relativePath: 'theme.json', content: JSON.stringify(result.model.themeJson, null, 2) + '\n' },
    ...recordFiles('templates', result.model.templates),
    ...recordFiles('parts', result.model.parts),
    ...recordFiles('patterns', result.model.patterns),
    ...(options.extraThemeFiles ?? []),
    { relativePath: 'functions.php', content: options.functionsPhp },
  ]);
  const normalizedWritten = result.written.map(normalizeThemePath);
  const assetFiles = [...new Set(normalizedWritten.filter((path) => path.startsWith('assets/')))].sort();

  return {
    themeFiles,
    assetSourceDir: result.outDir,
    assetFiles,
    writtenThemeFiles: themeFiles.map((file) => file.relativePath),
  };
}

function buildDlaLocalThemeFiles(options: DlaLocalPageThemeOptions): ReplicaFile[] {
  return assembleLocalTheme({
    siteTitle: options.siteTitle,
    themeSlug: options.themeSlug,
    headerPart: '',
    footerPart: '',
    mainClass: options.mainClass,
    mainWrapperClass: options.mainWrapperClass,
    interiorChromeTemplates: options.interiorChromeTemplates ?? [],
    carrySourceAssets: options.carrySourceAssets,
    instanceStylesCss: options.instanceStylesCss,
    jetpackFormParityCss: options.jetpackFormParityCss,
  });
}

async function refineHomeChromeFallback(theme: ThemeModel, options: DlaLocalPageThemeOptions): Promise<ThemeModel> {
  if (!options.site) return theme;
  const home = options.site.pages.find((page) => page.slug === 'home') ?? options.site.pages[0];
  if (!home) return theme;
  const pageSlugs = options.site.pages.map((page) => page.slug);
  const sections = segmentPage(home.html);
  const parts = { ...theme.parts };
  const carriedCss = (options.carrySourceAssets?.css ?? '').trim().length > 0;
  const mounts = options.allowSourceChromeMounts ? findEngineChromeMounts(home.html) : {};

  const header = sections.find((section) => section.role === 'header') ?? sections.find((section) => section.role === 'nav');
  if (header) {
    parts['header.html'] = await buildEngineCarriedHeaderPart(carriedCss ? combineHeaderWithRails(header, sections) : header, {
      pageSlugs,
      convertPart: rawPartMarkup,
      ...(options.sticky ? { sticky: options.sticky } : {}),
    });
  } else if (mounts.header) {
    parts['header.html'] = engineMountPartMarkup(mounts.header, options.sticky);
  } else {
    parts['header.html'] = buildEngineHeaderPart(options.siteTitle, [], pageSlugs, {
      plain: carriedCss,
      ...(options.sticky ? { sticky: options.sticky } : {}),
    });
  }

  const footer = sections.find((section) => section.role === 'footer') ?? null;
  parts['footer.html'] = mounts.footer
    ? engineMountPartMarkup(mounts.footer)
    : await buildEngineFooterPart(footer, options.siteTitle, { pageSlugs, convertPart: rawPartMarkup });

  return { ...theme, parts };
}

function rawPartMarkup(html: string): string {
  return html;
}

function combineHeaderWithRails(header: EngineSection, sections: EngineSection[]): EngineSection {
  const rails = sections.filter((section) => section.chromeSource === 'layout-rail' && section !== header);
  if (rails.length === 0) return header;
  const normalizedHeader = header.html.replace(/^<header(\b[^>]*>)/i, '<div$1').replace(/<\/header>\s*$/i, '</div>');
  return {
    ...header,
    html: `<div class="dla-carried-header-chrome">${[normalizedHeader, ...rails.map((rail) => rail.html)].join('\n')}</div>`,
    classes: ['dla-carried-header-chrome'],
  };
}

function paletteToken(name: string, role: TokenValue | undefined): FoundationTokens['palette'][number] | null {
  const color = role?.value?.trim();
  return color ? { name, color } : null;
}

function stringProp<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  const trimmed = value?.trim();
  return trimmed ? { [key]: trimmed } as Partial<Record<K, string>> : {};
}

function recordFiles(baseDir: string, files: Record<string, string>): ReplicaFile[] {
  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, content]) => ({
      relativePath: recordRelativePath(baseDir, key),
      content,
    }));
}

function recordRelativePath(baseDir: string, key: string): string {
  const trimmed = key.trim();
  if (trimmed.startsWith(`${baseDir}/`) || trimmed.includes('/')) return normalizeThemePath(trimmed);
  const filename = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.html`;
  return normalizeThemePath(`${baseDir}/${filename}`);
}

function normalizeThemePath(path: string): string {
  const input = path.replace(/\\/g, '/');
  const normalized = normalize(input).replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || input.startsWith('/')) {
    throw new Error(`theme path must stay relative: ${path}`);
  }
  return normalized;
}

function mergeThemeJson(
  themeJson: Record<string, unknown>,
  incomingJson: Record<string, unknown>,
  options: DlaLocalPageThemeOptions,
): Record<string, unknown> {
  const next = { ...themeJson };
  const sourceCssCarried = (options.carrySourceAssets?.css ?? '').trim().length > 0;
  if (sourceCssCarried) {
    delete next.styles;
    next.settings = mergeSettingsForCarry(next.settings, incomingJson.settings);
  }
  return mergeCustomTemplates(next, incomingJson.customTemplates);
}

function mergeCustomTemplates(themeJson: Record<string, unknown>, incoming: unknown): Record<string, unknown> {
  if (!Array.isArray(incoming)) return themeJson;
  const existing = Array.isArray(themeJson.customTemplates) ? themeJson.customTemplates : [];
  const incomingNames = new Set(
    incoming
      .map((entry) => templateName(entry))
      .filter((name): name is string => !!name),
  );
  const kept = existing.filter((entry) => {
    const name = templateName(entry);
    return !name || !incomingNames.has(name);
  });
  return {
    ...themeJson,
    customTemplates: [...kept, ...incoming],
  };
}

function templateName(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const name = (entry as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name : undefined;
}

function mergeSettingsForCarry(existing: unknown, incoming: unknown): unknown {
  const existingRecord = recordOrEmpty(existing);
  const incomingRecord = recordOrEmpty(incoming);
  const existingSpacing = recordOrEmpty(existingRecord.spacing);
  const incomingSpacing = recordOrEmpty(incomingRecord.spacing);
  return {
    ...existingRecord,
    spacing: {
      ...existingSpacing,
      ...incomingSpacing,
    },
  };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function dedupeThemeFiles(files: ReplicaFile[]): ReplicaFile[] {
  const byPath = new Map<string, ReplicaFile>();
  for (const file of files) byPath.set(normalizeThemePath(file.relativePath), { ...file, relativePath: normalizeThemePath(file.relativePath) });
  return [...byPath.values()];
}

function emptyPalette(): PaletteAgg {
  return { version: 1, sampledUrls: 0, colors: [] };
}

function emptyTypography(): TypographyAgg {
  return { version: 1, sampledUrls: 0, bySelector: {} };
}

function emptyBreakpoints(): BreakpointsAgg {
  return { version: 1, sampledUrls: 0, minWidth: [], maxWidth: [] };
}
