import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyUrl, type UrlType } from '../extraction/sitemap.js';
import { computeInputsDigest } from './foundation-drift.js';
import { loadReplicateState, saveReplicateState } from './replicate-state.js';

export interface FoundationRevDecision {
  shouldRun: boolean;
  digest: string | null;
  reason: string;
}

export interface FoundationSampleEntry {
  url: string;
  html?: string | null;
  screenshot?: string | null;
  scrolledScreenshot?: string | null;
}

export type FoundationSample = Partial<Record<UrlType, FoundationSampleEntry[]>>;

interface ManifestEntry {
  html?: string;
  desktop?: string;
  desktopScrolled?: string;
}

interface Manifest {
  entries?: Record<string, ManifestEntry>;
}

const FOUNDATION_INPUT_FILES = ['palette.json', 'typography.json', 'breakpoints.json'] as const;
const OPTIONAL_FOUNDATION_INPUT_FILES = ['computed-styles.json'] as const;
const DEFAULT_MAX_FOUNDATION_SAMPLES = 1;
const FOUNDATION_ARCHETYPE_PRIORITY: UrlType[] = ['homepage', 'page', 'product', 'post', 'gallery', 'event'];

export function readCurrentFoundationInputsDigest(outputDir: string): string | null {
  try {
    const [palette, typography, breakpoints] = FOUNDATION_INPUT_FILES.map((file) =>
      JSON.parse(readFileSync(join(outputDir, file), 'utf8')) as unknown,
    );
    const computedStyles = readOptionalJson(outputDir, OPTIONAL_FOUNDATION_INPUT_FILES[0]);
    return computeInputsDigest(palette, typography, breakpoints, computedStyles);
  } catch {
    return null;
  }
}

function readOptionalJson(outputDir: string, file: string): unknown {
  const path = join(outputDir, file);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export function foundationRevDecision(outputDir: string): FoundationRevDecision {
  const digest = readCurrentFoundationInputsDigest(outputDir);
  if (!digest) {
    return { shouldRun: true, digest: null, reason: 'foundation inputs unavailable' };
  }

  const state = loadReplicateState(outputDir);
  if (state.lastFoundationInputsDigest === digest) {
    return { shouldRun: false, digest, reason: 'foundation inputs unchanged' };
  }

  return {
    shouldRun: true,
    digest,
    reason: state.lastFoundationInputsDigest ? 'foundation inputs changed' : 'foundation inputs not recorded',
  };
}

export function recordFoundationInputsDigest(outputDir: string): string | null {
  const digest = readCurrentFoundationInputsDigest(outputDir);
  if (!digest) return null;

  const state = loadReplicateState(outputDir);
  saveReplicateState(outputDir, {
    ...state,
    lastFoundationInputsDigest: digest,
  });
  return digest;
}

export function selectFoundationSample(
  representatives: Partial<Record<string, FoundationSampleEntry[]>>,
  maxSamples = DEFAULT_MAX_FOUNDATION_SAMPLES,
): FoundationSample {
  const out: FoundationSample = {};
  if (maxSamples <= 0) return out;

  let selected = 0;
  for (const archetype of FOUNDATION_ARCHETYPE_PRIORITY) {
    const entries = representatives[archetype];
    if (!Array.isArray(entries) || entries.length === 0) continue;

    const remaining = maxSamples - selected;
    if (remaining <= 0) break;

    const picked = entries.slice(0, remaining);
    out[archetype] = picked;
    selected += picked.length;
  }
  return out;
}

export function buildFoundationSampleFromManifest(
  outputDir: string,
  maxSamples = DEFAULT_MAX_FOUNDATION_SAMPLES,
): FoundationSample {
  const manifestPath = join(outputDir, 'screenshots', 'manifest.json');
  if (!existsSync(manifestPath)) return {};

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch {
    return {};
  }

  const buckets: Partial<Record<UrlType, FoundationSampleEntry[]>> = {};
  const entries = manifest.entries ?? {};
  for (const [url, entry] of Object.entries(entries)) {
    const archetype = classifyUrl(url);
    const bucket = buckets[archetype] ?? [];
    bucket.push({
      url,
      html: entry.html ?? null,
    });
    buckets[archetype] = bucket;
  }

  return selectFoundationSample(buckets, maxSamples);
}
