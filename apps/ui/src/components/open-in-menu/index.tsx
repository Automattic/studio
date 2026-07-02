import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { code, copy, download, grid, trash } from '@wordpress/icons';
import { useState } from 'react';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import * as Menu from '@/components/menu';
import { QuickMenuItem, QuickMenuPopup, QuickMenuTrigger } from '@/components/site-quick-menu';
import { useConnector } from '@/data/core';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import {
	appleTerminalLogo,
	editorLogos,
	finderLogo,
	folderLogo,
	phpMyAdminLogo,
	terminalLogos,
} from './logos';
import type { SiteDetails } from '@/data/core';
import type { ReactElement } from 'react';

type OpenInDestination = 'files' | 'editor' | 'terminal' | 'phpmyadmin';

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

function getFileManager(): { label: string; logo: ReactElement } {
	const platform = navigator.platform.toLowerCase();
	if ( platform.includes( 'win' ) ) {
		return { label: __( 'File Explorer' ), logo: folderLogo };
	}
	if ( platform.includes( 'linux' ) ) {
		return { label: __( 'File manager' ), logo: folderLogo };
	}
	return { label: __( 'Finder' ), logo: finderLogo };
}

export function OpenInMenu( { site }: { site: SiteDetails } ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const { data: userPreferences } = useUserPreferences();
	const openSiteUrl = useOpenSiteUrl( site );
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const [ deleteOpen, setDeleteOpen ] = useState( false );

	const busy = isStarting || isStopping;
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;
	const fileManager = getFileManager();
	const editorLabel = userPreferences?.editor
		? supportedEditorConfig[ userPreferences.editor ].label
		: __( 'Editor' );
	const editorLogo = userPreferences?.editor ? editorLogos[ userPreferences.editor ] : undefined;
	const terminalLabel = userPreferences?.terminal
		? terminalConfig[ userPreferences.terminal ].name
		: __( 'Terminal' );
	const terminalLogo = userPreferences?.terminal
		? terminalLogos[ userPreferences.terminal ]
		: appleTerminalLogo;

	// The trigger reflects the destination the user opened last, like a
	// split button's default action.
	const [ lastUsed, setLastUsed ] = useState< OpenInDestination >( getStoredDestination );
	const destinationLogos: Record< OpenInDestination, ReactElement > = {
		files: fileManager.logo,
		editor: editorLogo ?? code,
		terminal: terminalLogo,
		phpmyadmin: phpMyAdminLogo,
	};

	const rememberDestination = ( destination: OpenInDestination ) => {
		setLastUsed( destination );
		try {
			window.localStorage.setItem( LAST_USED_STORAGE_KEY, destination );
		} catch {
			// Storage failures only mean the trigger icon won't persist.
		}
	};

	const openFolder = () => {
		rememberDestination( 'files' );
		void connector.openSiteFolder( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site folder:', error );
		} );
	};

	const openEditor = () => {
		if ( ! userPreferences?.editor ) {
			void navigate( { to: '/settings' } );
			return;
		}
		rememberDestination( 'editor' );
		void connector.openSiteInEditor( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site in editor:', error );
		} );
	};

	const openTerminal = () => {
		rememberDestination( 'terminal' );
		void connector.openSiteInTerminal( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site in terminal:', error );
		} );
	};

	const openPhpMyAdmin = () => {
		rememberDestination( 'phpmyadmin' );
		void openSiteUrl( '/phpmyadmin/index.php?route=/database/structure&db=wordpress' );
	};

	const destinationLabels: Record< OpenInDestination, string > = {
		files: fileManager.label,
		editor: editorLabel,
		terminal: terminalLabel,
		phpmyadmin: __( 'phpMyAdmin' ),
	};
	const destinationActions: Record< OpenInDestination, () => void > = {
		files: openFolder,
		editor: openEditor,
		terminal: openTerminal,
		phpmyadmin: openPhpMyAdmin,
	};

	return (
		<>
			<Menu.Root modal={ false }>
				<QuickMenuTrigger
					menuLabel={ __( 'Open in…' ) }
					actionLabel={ sprintf(
						// translators: %s is the app the site opens in, e.g. "Finder".
						__( 'Open in %s' ),
						destinationLabels[ lastUsed ]
					) }
					logo={ destinationLogos[ lastUsed ] }
					onActionClick={ () => destinationActions[ lastUsed ]() }
				/>
				<QuickMenuPopup>
					<QuickMenuItem
						icon={ fileManager.logo }
						label={ fileManager.label }
						onClick={ openFolder }
					/>
					<QuickMenuItem icon={ editorLogo ?? code } label={ editorLabel } onClick={ openEditor } />
					<QuickMenuItem icon={ terminalLogo } label={ terminalLabel } onClick={ openTerminal } />
					<QuickMenuItem
						icon={ phpMyAdminLogo }
						label={ __( 'phpMyAdmin' ) }
						disabled={ busy }
						onClick={ openPhpMyAdmin }
					/>
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
