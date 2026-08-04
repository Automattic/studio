import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import * as Menu from '@/components/menu';
import { QuickMenuItem, QuickMenuPopup, QuickMenuTrigger } from '@/components/site-quick-menu';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import { useOpenInDestinations } from './use-open-in-destinations';
import type { OpenInDestination } from './use-open-in-destinations';
import type { SiteDetails } from '@/data/core';

const lastUsedStorageKey = ( siteId: string ) => `studio:open-in-menu:last-used:${ siteId }`;

function isOpenInDestination( value: string | null ): value is OpenInDestination {
	return value === 'browser' || value === 'files' || value === 'editor' || value === 'terminal';
}

function getStoredDestination( siteId: string ): OpenInDestination {
	try {
		const stored = window.localStorage.getItem( lastUsedStorageKey( siteId ) );
		return isOpenInDestination( stored ) ? stored : 'browser';
	} catch {
		return 'browser';
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
 * Just the destination items, for embedding in another menu (the preview's
 * narrow-toolbar overflow). Site-management actions (Duplicate, Export,
 * Delete) stay with the full `OpenInMenu` and the sidebar context menu.
 */
export function OpenInDestinationItems( {
	site,
	browserPath,
}: {
	site: SiteDetails;
	browserPath?: string;
} ) {
	const destinations = useOpenInDestinations(
		site,
		( destination ) => storeLastUsedDestination( site.id, destination ),
		browserPath
	);
	return (
		<>
			{ destinations.map( ( destination ) => (
				<QuickMenuItem
					key={ destination.id }
					icon={ destination.logo }
					label={ destination.label }
					disabled={ destination.disabled }
					onClick={ destination.open }
				/>
			) ) }
		</>
	);
}

export function OpenInMenu( {
	site,
	browserPath,
}: {
	site: SiteDetails;
	// Enables the "Browser" destination at this site-relative path.
	browserPath?: string;
} ) {
	const navigate = useNavigate();
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const managementActions = useSiteManagementActions( site, {
		onDelete: () => setDeleteOpen( true ),
	} );

	// The trigger reflects the destination the user opened last, like a
	// split button's default action.
	const [ lastUsed, setLastUsed ] = useState< OpenInDestination >( () =>
		getStoredDestination( site.id )
	);
	useEffect( () => setLastUsed( getStoredDestination( site.id ) ), [ site.id ] );

	const rememberDestination = ( destination: OpenInDestination ) => {
		setLastUsed( destination );
		storeLastUsedDestination( site.id, destination );
	};

	const destinations = useOpenInDestinations( site, rememberDestination, browserPath );
	const lastUsedDestination =
		destinations.find( ( destination ) => destination.id === lastUsed ) ?? destinations[ 0 ];

	return (
		<>
			<Menu.Root modal={ false }>
				<QuickMenuTrigger
					menuLabel={ __( 'Open in…' ) }
					actionLabel={ sprintf(
						// translators: %s is the app the site opens in, e.g. "Finder".
						__( 'Open in %s' ),
						lastUsedDestination.label
					) }
					logo={ lastUsedDestination.logo }
					onActionClick={ () => lastUsedDestination.open() }
				/>
				<QuickMenuPopup>
					{ destinations.map( ( destination ) => (
						<QuickMenuItem
							key={ destination.id }
							icon={ destination.logo }
							label={ destination.label }
							disabled={ destination.disabled }
							onClick={ destination.open }
						/>
					) ) }
					<Menu.Separator />
					{ managementActions
						.filter( ( action ) => ! action.destructive )
						.map( ( action ) => (
							<QuickMenuItem
								key={ action.id }
								icon={ action.icon }
								label={ action.label }
								disabled={ action.disabled }
								onClick={ action.run }
							/>
						) ) }
					<Menu.Separator />
					{ managementActions
						.filter( ( action ) => action.destructive )
						.map( ( action ) => (
							<QuickMenuItem
								key={ action.id }
								icon={ action.icon }
								label={ action.label }
								disabled={ action.disabled }
								destructive
								onClick={ action.run }
							/>
						) ) }
				</QuickMenuPopup>
			</Menu.Root>
			<DeleteSiteDialog
				site={ site }
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onDeleted={ () => void navigate( { to: '/' } ) }
			/>
		</>
	);
}
