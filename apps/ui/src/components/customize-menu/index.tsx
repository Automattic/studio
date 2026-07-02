import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import * as Menu from '@/components/menu';
import { QuickMenuItem, QuickMenuPopup, QuickMenuTrigger } from '@/components/site-quick-menu';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import { useCustomizeLinks } from '@/hooks/use-customize-links';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import type { SiteDetails } from '@/data/core';
import type { CustomizeLink } from '@/hooks/use-customize-links';

const LAST_USED_STORAGE_KEY = 'studio:customize-menu:last-used';

function getStoredLinkId(): string | null {
	try {
		return window.localStorage.getItem( LAST_USED_STORAGE_KEY );
	} catch {
		return null;
	}
}

export function CustomizeMenu( { site }: { site: SiteDetails } ) {
	const openSiteUrl = useOpenSiteUrl( site );
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { customizeLinks, contentLinks, adminLink, allLinks } = useCustomizeLinks( site );
	const [ lastUsedId, setLastUsedId ] = useState( getStoredLinkId );

	const busy = isStarting || isStopping;

	// The trigger's default action is the link the user opened last; fall
	// back to the group's main surface (Plugins screen for plugin sites,
	// Site Editor / Customizer otherwise).
	const lastUsed = allLinks.find( ( link ) => link.id === lastUsedId ) ?? customizeLinks[ 0 ];

	const openLink = ( link: CustomizeLink ) => {
		setLastUsedId( link.id );
		try {
			window.localStorage.setItem( LAST_USED_STORAGE_KEY, link.id );
		} catch {
			// Storage failures only mean the trigger icon won't persist.
		}
		void openSiteUrl( link.url );
	};

	const linkItem = ( link: CustomizeLink ) => (
		<QuickMenuItem
			key={ link.id }
			icon={ link.icon }
			label={ link.label }
			disabled={ busy }
			onClick={ () => openLink( link ) }
		/>
	);

	return (
		<Menu.Root modal={ false }>
			<QuickMenuTrigger
				menuLabel={ __( 'Open WordPress…' ) }
				actionLabel={ sprintf(
					// translators: %s is a WP Admin destination, e.g. "Site Editor".
					__( 'Open %s' ),
					lastUsed.label
				) }
				logo={ lastUsed.icon }
				onActionClick={ () => openLink( lastUsed ) }
			/>
			<QuickMenuPopup>
				{ customizeLinks.map( linkItem ) }
				<Menu.Separator />
				{ contentLinks.map( linkItem ) }
				<Menu.Separator />
				{ linkItem( adminLink ) }
			</QuickMenuPopup>
		</Menu.Root>
	);
}
