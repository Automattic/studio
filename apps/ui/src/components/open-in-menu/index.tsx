import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { copy, download, grid, trash } from '@wordpress/icons';
import { useState } from 'react';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import * as Menu from '@/components/menu';
import { QuickMenuItem, QuickMenuPopup, QuickMenuTrigger } from '@/components/site-quick-menu';
import { useCopySite, useExportDatabase, useExportFullSite } from '@/data/queries/use-sites';
import { useOpenInDestinations } from './use-open-in-destinations';
import type { OpenInDestination } from './use-open-in-destinations';
import type { SiteDetails } from '@/data/core';

const LAST_USED_STORAGE_KEY = 'studio:open-in-menu:last-used';

function isOpenInDestination( value: string | null ): value is OpenInDestination {
	return (
		value === 'browser' ||
		value === 'files' ||
		value === 'editor' ||
		value === 'terminal' ||
		value === 'phpmyadmin'
	);
}

function getStoredDestination(): OpenInDestination {
	try {
		const stored = window.localStorage.getItem( LAST_USED_STORAGE_KEY );
		return isOpenInDestination( stored ) ? stored : 'files';
	} catch {
		return 'files';
	}
}

function storeLastUsedDestination( destination: OpenInDestination ): void {
	try {
		window.localStorage.setItem( LAST_USED_STORAGE_KEY, destination );
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
	browserUrl,
}: {
	site: SiteDetails;
	browserUrl?: string;
} ) {
	const destinations = useOpenInDestinations( site, storeLastUsedDestination, browserUrl );
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
	browserUrl,
}: {
	site: SiteDetails;
	// Enables the "Browser" destination: the absolute URL to open externally
	// (e.g. the preview's current page).
	browserUrl?: string;
} ) {
	const navigate = useNavigate();
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const [ deleteOpen, setDeleteOpen ] = useState( false );

	const isExporting = exportFullSite.isPending || exportDatabase.isPending;

	// The trigger reflects the destination the user opened last, like a
	// split button's default action.
	const [ lastUsed, setLastUsed ] = useState< OpenInDestination >( getStoredDestination );

	const rememberDestination = ( destination: OpenInDestination ) => {
		setLastUsed( destination );
		storeLastUsedDestination( destination );
	};

	const destinations = useOpenInDestinations( site, rememberDestination, browserUrl );
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
					<QuickMenuItem
						icon={ copy }
						label={ __( 'Duplicate' ) }
						disabled={ copySite.isPending }
						onClick={ () => copySite.mutate( site.id ) }
					/>
					<QuickMenuItem
						icon={ download }
						label={ __( 'Export' ) }
						disabled={ isExporting }
						onClick={ () => exportFullSite.mutate( site.id ) }
					/>
					<QuickMenuItem
						icon={ grid }
						label={ __( 'Export DB' ) }
						disabled={ isExporting }
						onClick={ () => exportDatabase.mutate( site.id ) }
					/>
					<Menu.Separator />
					<QuickMenuItem
						icon={ trash }
						label={ __( 'Delete' ) }
						destructive
						onClick={ () => setDeleteOpen( true ) }
					/>
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
