import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { captureException } from '@studio/common/lib/error-reporting';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { browserConfig } from '@studio/common/lib/user-settings/browser';
import {
	getFirstInstalledEditor,
	supportedEditorConfig,
} from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { __, sprintf } from '@wordpress/i18n';
import { CodeIcon } from 'lucide-react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { AppIcon } from '@/features/sites/app-icon';
import { DATABASE_HOME_PATH } from '@/features/sites/site-preview/address-bar';
import {
	DatabaseIcon,
	ExternalLinkIcon,
	FolderIcon,
	TerminalIcon,
	WordPressIcon,
} from '@/lib/icons';
import type { SiteDetails } from '@/data/core';
import type { ReactElement } from 'react';

export type OpenInDestination =
	| 'browser'
	| 'browser-wordpress'
	| 'wp-admin'
	| 'files'
	| 'editor'
	| 'terminal'
	| 'phpmyadmin';

interface OpenInDestinationEntry {
	id: OpenInDestination;
	label: string;
	logo: ReactElement;
	disabled: boolean;
	open: () => void;
}

function getFileManager(): { label: string; logo: ReactElement } {
	const platform = navigator.platform.toLowerCase();
	if ( platform.includes( 'win' ) ) {
		return { label: __( 'File Explorer' ), logo: <FolderIcon /> };
	}
	if ( platform.includes( 'linux' ) ) {
		return { label: __( 'File manager' ), logo: <FolderIcon /> };
	}
	return { label: __( 'Finder' ), logo: <AppIcon app="finder" fallback={ <FolderIcon /> } /> };
}

/**
 * The "Open in…" destinations for a site (browser, WP Admin, file manager,
 * editor, terminal, phpMyAdmin) with their labels, logos, and open handlers. One
 * list feeds the site menu, the command palette and the site settings, so they
 * never drift.
 *
 * Every destination means "open this site in X" — the browser, WP Admin and
 * phpMyAdmin entries open in the OS browser, not the preview panel. The preview's
 * address bar owns in-app navigation, including opening its current page
 * externally.
 *
 * The editor is the preferred one, else the first one installed; with neither
 * there's no editor entry. Browser, WordPress admin and phpMyAdmin
 * start a stopped site first. A failure to open is reported.
 *
 * For a headless site, the browser, editor and terminal open its frontend
 * app, and a second browser entry opens WordPress's own front end.
 */
export function useOpenInDestinations(
	site: SiteDetails,
	onOpen?: ( destination: OpenInDestination ) => void
): OpenInDestinationEntry[] {
	const connector = useConnector();
	const { data: userPreferences } = useUserPreferences();
	const { data: installedApps } = useInstalledApps();
	const browserLabel = userPreferences?.browser
		? browserConfig[ userPreferences.browser ].name
		: __( 'Browser' );
	const startSite = useStartSiteWithChat();

	const fileManager = getFileManager();
	const editor =
		userPreferences?.editor ?? ( installedApps ? getFirstInstalledEditor( installedApps ) : null );
	const editorLabel = editor ? supportedEditorConfig[ editor ].label() : '';
	const terminalLabel = userPreferences?.terminal
		? terminalConfig[ userPreferences.terminal ].name()
		: __( 'Terminal' );
	const terminal = userPreferences?.terminal ?? 'terminal';
	const isMac = /Mac/.test( navigator.platform );

	const open = ( destination: OpenInDestination, label: string, run: () => Promise< unknown > ) => {
		onOpen?.( destination );
		void run().catch( ( error ) => {
			console.error( `Failed to open the site in ${ destination }:`, error );
			captureException( error );
			/* translators: %s: where the site was being opened, e.g. "Terminal" or "phpMyAdmin". */
			toast.error( sprintf( __( 'Couldn’t open %s' ), label ), {
				description: getErrorMessage( error ),
			} );
		} );
	};

	const headless = !! site.frontend;
	const projectTarget = headless ? { target: 'frontend' as const } : undefined;
	const openSiteUrl = async (
		path: string,
		options?: { autoLogin: boolean; target?: 'frontend' }
	) => {
		// A failed start reports itself.
		if ( ! site.running && ! ( await startSite.mutateAsync( site.id ).catch( () => false ) ) ) {
			return;
		}
		if ( options ) {
			await connector.openSiteUrl( site.id, path, options );
		} else {
			await connector.openSiteUrl( site.id, path );
		}
	};

	const browserLogo = (
		<AppIcon app={ userPreferences?.browser ?? undefined } fallback={ <ExternalLinkIcon /> } />
	);
	const destinations: Array< OpenInDestinationEntry | false > = [
		{
			id: 'files',
			label: fileManager.label,
			logo: fileManager.logo,
			disabled: false,
			open: () =>
				open( 'files', fileManager.label, () => {
					void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_FOLDER );
					return connector.openSiteFolder( site.id );
				} ),
		},
		{
			id: 'browser',
			label: browserLabel,
			logo: browserLogo,
			disabled: false,
			open: () =>
				open( 'browser', __( 'Browser' ), () => {
					void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_IN_BROWSER, { browser: 'external' } );
					// The front end opens logged out; only WP Admin signs the user in.
					return openSiteUrl( '/', { autoLogin: false, ...projectTarget } );
				} ),
		},
		headless && {
			id: 'browser-wordpress',
			label: __( 'WordPress front end' ),
			logo: browserLogo,
			disabled: false,
			open: () =>
				open( 'browser-wordpress', __( 'Browser' ), () => {
					void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_IN_BROWSER, { browser: 'external' } );
					return openSiteUrl( '/', { autoLogin: false } );
				} ),
		},
		!! editor && {
			id: 'editor',
			label: editorLabel,
			logo: <AppIcon app={ editor } fallback={ <CodeIcon /> } />,
			disabled: false,
			open: () =>
				open( 'editor', editorLabel, () =>
					projectTarget
						? connector.openSiteInEditor( site.id, projectTarget )
						: connector.openSiteInEditor( site.id )
				),
		},
		{
			id: 'terminal',
			label: terminalLabel,
			logo: (
				<AppIcon
					app={ terminal === 'terminal' && ! isMac ? undefined : terminal }
					fallback={ <TerminalIcon /> }
				/>
			),
			disabled: false,
			open: () =>
				open( 'terminal', terminalLabel, () =>
					projectTarget
						? connector.openSiteInTerminal( site.id, projectTarget )
						: connector.openSiteInTerminal( site.id )
				),
		},
		{
			id: 'wp-admin',
			label: __( 'WordPress admin' ),
			logo: <WordPressIcon />,
			disabled: false,
			open: () =>
				open( 'wp-admin', __( 'WordPress admin' ), () => {
					void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_WP_ADMIN, { browser: 'external' } );
					return openSiteUrl( '/wp-admin/' );
				} ),
		},
		{
			id: 'phpmyadmin',
			label: __( 'phpMyAdmin' ),
			logo: <AppIcon app="phpmyadmin" fallback={ <DatabaseIcon /> } />,
			disabled: false,
			open: () =>
				open( 'phpmyadmin', __( 'phpMyAdmin' ), async () => {
					void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN, { browser: 'external' } );
					await openSiteUrl( DATABASE_HOME_PATH );
				} ),
		},
	];
	return destinations.filter( ( destination ) => destination !== false );
}
