import type { PlatformAdapter } from '../../types.js';
import { discoverDefault } from './discover.js';

export type { DefaultInventory, DefaultAdapterOpts } from './types.js';

// The generic fallback never positively identifies a platform — it is reached
// via the registry's fallback resolution when detection returns 'unknown' (or
// names a platform with no registration). It therefore declares no detection
// signals; see src/platform/builtins.ts for the fallback registration.
export const defaultAdapter: PlatformAdapter = {
  id: 'default',
  discover: discoverDefault,
};
