import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import * as Menu from '@/components/menu';
import { SplitButtonMenu } from '@/components/split-button-menu';
import { useCustomizeLinks } from '@/hooks/use-customize-links';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import type { SiteDetails } from '@/data/core';
import type { SiteUrlTarget } from '@/hooks/use-open-site-url';

const storageKey = ( siteId: string ) => `studio:wordpress-menu:last-used:${ siteId }`;
const targetStorageKey = 'studio:wordpress-menu:target';
const DEFAULT_DESTINATION = 'wp-admin';

function getStoredTarget(): SiteUrlTarget {
	try {
		return window.localStorage.getItem( targetStorageKey ) === 'browser' ? 'browser' : 'studio';
	} catch {
		return 'studio';
	}
}

function storeTarget( target: SiteUrlTarget ): void {
	try {
		window.localStorage.setItem( targetStorageKey, target );
	} catch {
		// Storage failures only reset the choice to Studio next time.
	}
}

function getStoredDestination( siteId: string ): string {
	try {
		return window.localStorage.getItem( storageKey( siteId ) ) ?? DEFAULT_DESTINATION;
	} catch {
		return DEFAULT_DESTINATION;
	}
}

function storeDestination( siteId: string, destination: string ): void {
	try {
		window.localStorage.setItem( storageKey( siteId ), destination );
	} catch {
		// Storage failures only mean the primary action will reset to WP Admin.
	}
}

export function WordPressMenu( { site }: { site: SiteDetails } ) {
	const { customizeLinks, contentLinks, adminLink } = useCustomizeLinks( site );
	const [ target, setTarget ] = useState< SiteUrlTarget >( getStoredTarget );
	const openSiteUrl = useOpenSiteUrl( site, target );
	const destinations = [ adminLink, ...customizeLinks, ...contentLinks ];
	const [ lastUsed, setLastUsed ] = useState( () => getStoredDestination( site.id ) );
	const lastUsedDestination =
		destinations.find( ( destination ) => destination.id === lastUsed ) ?? adminLink;

	const openDestination = ( id: string, url: string ) => {
		setLastUsed( id );
		storeDestination( site.id, id );
		void openSiteUrl( url );
	};
	const selectTarget = ( value: unknown ) => {
		if ( value !== 'studio' && value !== 'browser' ) {
			return;
		}
		setTarget( value );
		storeTarget( value );
	};

	return (
		<SplitButtonMenu
			actionLabel={ sprintf(
				// translators: %s is a WordPress screen, e.g. "WP Admin".
				__( 'Open %s' ),
				lastUsedDestination.label
			) }
			actionIcon={ lastUsedDestination.icon }
			onAction={ () => openDestination( lastUsedDestination.id, lastUsedDestination.url ) }
			menuLabel={ __( 'Open WordPress…' ) }
			items={ destinations.map( ( destination ) => ( {
				id: destination.id,
				label: destination.label,
				icon: destination.icon,
				onSelect: () => openDestination( destination.id, destination.url ),
			} ) ) }
			footer={
				<Menu.Group>
					<Menu.GroupLabel>{ __( 'Open WordPress screens in' ) }</Menu.GroupLabel>
					<Menu.RadioGroup value={ target } onValueChange={ selectTarget }>
						<Menu.RadioItem value="studio">{ __( 'Studio' ) }</Menu.RadioItem>
						<Menu.RadioItem value="browser">{ __( 'Default browser' ) }</Menu.RadioItem>
					</Menu.RadioGroup>
				</Menu.Group>
			}
		/>
	);
}
