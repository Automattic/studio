import type { PlatformAdapter } from '../types.js';

/**
 * Resolve a detected platform id to an adapter, falling back to the `default`
 * (fallback) adapter when the platform is unrecognized — i.e. when detection
 * returned `'unknown'` or named a platform with no registered adapter.
 *
 * Centralizing the fallback here keeps every entry point — the MCP handlers and
 * both CLI UIs (discover, inspect) — routing unidentified sites to the same
 * generic adapter. An exact id match always wins over the fallback.
 */
export function resolveAdapter(adapters: PlatformAdapter[], platform: string): PlatformAdapter | null {
  return (
    adapters.find((a) => a.id === platform)
    ?? adapters.find((a) => a.id === 'default')
    ?? null
  );
}
