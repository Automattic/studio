/**
 * useAddonMainContentRenderer — Renderer hook for main content routing.
 *
 * Calls each addon's mainContentRenderer in order. Returns the first non-null
 * ReactNode, or null to defer to core routing (<SiteContentTabs />).
 */
import { getEnabledAddons } from 'src/modules/addons/registry';
import type { ReactNode } from 'react';
import type { MainContentContext } from 'src/modules/addons/addon-api';

export function useAddonMainContentRenderer( context: MainContentContext ): ReactNode | null {
	for ( const addon of getEnabledAddons() ) {
		if ( addon.mainContentRenderer ) {
			const result = addon.mainContentRenderer( context );
			if ( result != null ) {
				return result;
			}
		}
	}
	return null;
}
