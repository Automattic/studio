/**
 * Hook — returns addon-registered content tabs.
 * The results are merged into the core tab list by use-content-tabs.tsx.
 */
import { useMemo } from 'react';
import { getEnabledAddons } from 'src/modules/addons/registry';
import type { AddonContentTab } from 'src/modules/addons/addon-api';

export function useAddonContentTabs(): AddonContentTab[] {
	return useMemo( () => getEnabledAddons().flatMap( ( addon ) => addon.contentTabs ?? [] ), [] );
}
