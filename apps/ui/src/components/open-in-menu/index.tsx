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
	return value === 'files' || value === 'editor' || value === 'terminal' || value === 'phpmyadmin';
}

function getStoredDestination(): OpenInDestination {
	try {
		const stored = window.localStorage.getItem( LAST_USED_STORAGE_KEY );
		return isOpenInDestination( stored ) ? stored : 'files';
	} catch {
		return 'files';
	}
}

export function OpenInMenu( { site }: { site: SiteDetails } ) {
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
		try {
			window.localStorage.setItem( LAST_USED_STORAGE_KEY, destination );
		} catch {
			// Storage failures only mean the trigger icon won't persist.
		}
	};

	const destinations = useOpenInDestinations( site, rememberDestination );
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
