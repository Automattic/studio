/**
 * Hook — returns addon-registered content tabs.
 * The results are merged into the core tab list by use-content-tabs.tsx.
 */
import { useMemo } from 'react';
import { useEnabledAddons } from 'src/modules/addons/enabled-addons-context';
import type { AddonContentTab } from 'src/modules/addons/addon-api';

export function useAddonContentTabs(): AddonContentTab[] {
	const enabledAddons = useEnabledAddons();
	return useMemo(
		() => enabledAddons.flatMap( ( addon ) => addon.contentTabs ?? [] ),
		[ enabledAddons ]
	);
}
