import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import { SplitButtonMenu } from '@/components/split-button-menu';
import { useOpenInDestinations } from './use-open-in-destinations';
import type { OpenInDestination } from './use-open-in-destinations';
import type { SiteDetails } from '@/data/core';

// Scoped per site: which app you reach for depends on what you're doing with
// that site, even though the apps themselves come from global preferences.
const lastUsedStorageKey = ( siteId: string ) => `studio:open-in-menu:last-used:${ siteId }`;
const DEFAULT_DESTINATION: OpenInDestination = 'browser';

function isOpenInDestination( value: string | null ): value is OpenInDestination {
	return value === 'browser' || value === 'files' || value === 'editor' || value === 'terminal';
}

function getStoredDestination( siteId: string ): OpenInDestination {
	try {
		const stored = window.localStorage.getItem( lastUsedStorageKey( siteId ) );
		return isOpenInDestination( stored ) ? stored : DEFAULT_DESTINATION;
	} catch {
		return DEFAULT_DESTINATION;
	}
}

function storeLastUsedDestination( siteId: string, destination: OpenInDestination ): void {
	try {
		window.localStorage.setItem( lastUsedStorageKey( siteId ), destination );
	} catch {
		// Storage failures only mean the split trigger won't persist.
	}
}

/**
 * Split button whose left half repeats the last destination the user opened
 * and whose chevron half opens the full list.
 *
 * The caller keys this on the site id, so the remembered destination is read
 * fresh when the workspace switches sites.
 */
export function OpenInMenu( {
	site,
	// The site-relative path the "Browser" destination opens — the preview's
	// current page.
	browserPath,
}: {
	site: SiteDetails;
	browserPath: string;
} ) {
	const [ lastUsed, setLastUsed ] = useState< OpenInDestination >( () =>
		getStoredDestination( site.id )
	);

	const rememberDestination = ( destination: OpenInDestination ) => {
		setLastUsed( destination );
		storeLastUsedDestination( site.id, destination );
	};

	const destinations = useOpenInDestinations( site, browserPath, rememberDestination );
	const lastUsedDestination =
		destinations.find( ( destination ) => destination.id === lastUsed ) ?? destinations[ 0 ];

	const actionLabel = sprintf(
		// translators: %s is the app the site opens in, e.g. "Finder".
		__( 'Open in %s' ),
		lastUsedDestination.label
	);

	return (
		<SplitButtonMenu
			actionLabel={ actionLabel }
			actionIcon={ lastUsedDestination.logo }
			actionDisabled={ lastUsedDestination.disabled }
			onAction={ lastUsedDestination.open }
			menuLabel={ __( 'Open in…' ) }
			items={ destinations.map( ( destination ) => ( {
				id: destination.id,
				label: destination.label,
				icon: destination.logo,
				disabled: destination.disabled,
				onSelect: destination.open,
			} ) ) }
		/>
	);
}
