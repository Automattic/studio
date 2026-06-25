import type { PlatformAdapter } from '../../types.js';
import { discoverDefault } from './discover.js';
import { extractDefault } from './extract.js';

export type { DefaultInventory, DefaultAdapterOpts } from './types.js';

// The fallback adapter never positively identifies a platform — it is reached
// via resolveAdapter()'s fallback when detection returns 'unknown' (or names an
// unregistered platform). detect() therefore always returns false; nothing in
// the pipeline selects adapters by their .detect() method anyway.
function detect(_url: string): boolean {
  return false;
}

export const defaultAdapter: PlatformAdapter = {
  id: 'default',
  detect,
  discover: discoverDefault,
  extract: extractDefault,
};
