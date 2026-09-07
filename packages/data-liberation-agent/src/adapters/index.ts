// src/adapters/index.ts
//
// Back-compat surface over the platform registry (src/platform/), preserved
// until #119 removes the extract-era callers (mcp-server handlers, the CLI
// UIs). The registry is the single source of truth for both adapter
// resolution and automatic detection.
import '../platform/builtins.js';
import { registeredPlatforms, resolvePlatform } from '../platform/registry.js';
import type { PlatformAdapter } from '../types.js';

/**
 * Legacy snapshot of the registered adapters, in registration order.
 * Consumer platforms registered after this module loads are still resolved by
 * {@link findAdapter} (which queries the registry live); they just don't
 * appear in this static list.
 */
export const adapters: PlatformAdapter[] = registeredPlatforms() as PlatformAdapter[];

/**
 * Resolve a detected platform id to an adapter, with generic-fallback
 * semantics (exact match first, then the registered fallback). Live against
 * the registry, so consumer-registered platforms resolve without core edits.
 *
 * NOTE: the PlatformAdapter cast is the legacy bridge — a custom platform
 * without `extract` still resolves here (capture only needs discover/capture
 * hooks); extract-era handlers would fail on it, which is the documented
 * behavior until #119 removes them.
 */
export function findAdapter(platform: string): PlatformAdapter | null {
  return resolvePlatform(platform) as PlatformAdapter | null;
}
