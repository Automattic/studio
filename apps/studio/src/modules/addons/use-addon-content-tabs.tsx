/**
 * Hook — returns addon-registered content tabs.
 * The results are merged into the core tab list by use-content-tabs.tsx.
 */
import { useMemo } from 'react';
import { getBundledAddons } from 'src/modules/addons/registry';
import type { AddonContentTab } from 'src/modules/addons/addon-api';

export function useAddonContentTabs(): AddonContentTab[] {
	return useMemo( () => getBundledAddons().flatMap( ( addon ) => addon.contentTabs ?? [] ), [] );
}
