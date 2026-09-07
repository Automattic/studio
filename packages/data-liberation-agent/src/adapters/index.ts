// src/adapters/index.ts
//
// Compatibility surface over the platform registry. The registry remains the
// single source of truth for both adapter resolution and automatic detection.
import '../platform/builtins.js';
import { registeredPlatforms, resolvePlatform } from '../platform/registry.js';
import type { PlatformAdapter } from '../types.js';

function registeredAdapters(): PlatformAdapter[] {
  return registeredPlatforms() as PlatformAdapter[];
}

/**
 * Legacy snapshot of the registered adapters, in registration order.
 * Consumer platforms registered after this module loads are still resolved by
 * {@link findAdapter} (which queries the registry live); they just don't
 * appear in this static list.
 */
export const adapters: PlatformAdapter[] = registeredAdapters();

/**
 * Resolve a detected platform id to an adapter, with generic-fallback
 * semantics (exact match first, then the registered fallback). Live against
 * the registry, so consumer-registered platforms resolve without core edits.
 *
 * The PlatformAdapter cast preserves this historical import path while the
 * public registry remains the authoritative platform contract.
 */
export function findAdapter(platform: string): PlatformAdapter | null {
  return resolvePlatform(platform) as PlatformAdapter | null;
}
