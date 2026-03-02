/**
 * useAddonMainContentRenderer — Renderer hook for main content routing.
 *
 * Calls each addon's mainContentRenderer in order. Returns the first non-null
 * ReactNode, or null to defer to core routing (<SiteContentTabs />).
 */
import { useEnabledAddons } from 'src/modules/addons/enabled-addons-context';
import type { ReactNode } from 'react';
import type { MainContentContext } from 'src/modules/addons/addon-api';

export function useAddonMainContentRenderer( context: MainContentContext ): ReactNode | null {
	const enabledAddons = useEnabledAddons();
	for ( const addon of enabledAddons ) {
		if ( addon.mainContentRenderer ) {
			const result = addon.mainContentRenderer( context );
			if ( result != null ) {
				return result;
			}
		}
	}
	return null;
}
