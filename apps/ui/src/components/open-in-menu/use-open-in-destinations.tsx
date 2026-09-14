import { captureException } from '@studio/common/lib/error-reporting';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { code, external } from '@wordpress/icons';
import { DATABASE_HOME_PATH } from '@/components/site-preview/address-bar';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import {
	databaseLogo,
	editorLogos,
	finderLogo,
	folderLogo,
	terminalLogo,
	terminalLogos,
} from '@/lib/logos';
import type { SiteDetails } from '@/data/core';
import type { ReactElement } from 'react';

export type OpenInDestination = 'browser' | 'files' | 'editor' | 'terminal' | 'phpmyadmin';

export interface OpenInDestinationEntry {
	id: OpenInDestination;
	label: string;
	logo: ReactElement;
	disabled: boolean;
	open: () => void;
}

export function getFileManager(): { label: string; logo: ReactElement } {
	const platform = navigator.platform.toLowerCase();
	if ( platform.includes( 'win' ) ) {
		return { label: __( 'File Explorer' ), logo: folderLogo };
	}
	if ( platform.includes( 'linux' ) ) {
		return { label: __( 'File manager' ), logo: folderLogo };
	}
	return { label: __( 'Finder' ), logo: finderLogo };
}

/**
 * The "Open in…" destinations for a site (browser, file manager, editor,
 * terminal, phpMyAdmin) with their labels, logos, and open handlers. One
 * list feeds both the Overview's shortcuts and the session header's menu so
 * the two never drift.
 *
 * Every destination means "open this site in X" — the browser and phpMyAdmin
 * entries open in the OS browser, not the preview panel. The preview's
 * address bar owns in-app navigation, including opening its current page
 * externally.
 *
 * `onOpen` fires only when a destination actually opens: picking the editor
 * without a configured preference navigates to settings instead and reports
 * nothing.
 *
 * Browser and phpMyAdmin need a running site; the rest work stopped.
 */
export function useOpenInDestinations(
	site: SiteDetails,
	onOpen?: ( destination: OpenInDestination ) => void
): OpenInDestinationEntry[] {
	const connector = useConnector();
	const navigate = useNavigate();
	const { data: userPreferences } = useUserPreferences();

	const fileManager = getFileManager();
	const editorLabel = userPreferences?.editor
		? supportedEditorConfig[ userPreferences.editor ].label()
		: __( 'Editor' );
	const editorLogo = userPreferences?.editor ? editorLogos[ userPreferences.editor ] : undefined;
	const terminalLabel = userPreferences?.terminal
		? terminalConfig[ userPreferences.terminal ].name()
		: __( 'Terminal' );
	const configuredTerminalLogo = userPreferences?.terminal
		? terminalLogos[ userPreferences.terminal ]
		: terminalLogo;

	return [
		{
			id: 'browser',
			label: __( 'Browser' ),
			// Not the globe: the address bar already uses that for the site's
			// front end, and this one leaves Studio.
			logo: external,
			disabled: ! site.running,
			open: () => {
				onOpen?.( 'browser' );
				void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_IN_BROWSER, { browser: 'external' } );
				// Routed through the host rather than `openExternalUrl` so the
				// URL goes via /studio-auto-login and keeps the session.
				void connector.openSiteUrl( site.id, '/' ).catch( ( error ) => {
					console.error( 'Failed to open site in browser:', error );
				} );
			},
		},
		{
			id: 'files',
			label: fileManager.label,
			logo: fileManager.logo,
			disabled: false,
			open: () => {
				onOpen?.( 'files' );
				void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_FOLDER );
				void connector.openSiteFolder( site.id ).catch( ( error ) => {
					console.error( 'Failed to open site folder:', error );
				} );
			},
		},
		{
			id: 'editor',
			label: editorLabel,
			logo: editorLogo ?? code,
			disabled: false,
			open: () => {
				if ( ! userPreferences?.editor ) {
					void navigate( { to: '/settings' } );
					return;
				}
				onOpen?.( 'editor' );
				void connector.openSiteInEditor( site.id ).catch( ( error ) => {
					console.error( 'Failed to open site in editor:', error );
				} );
			},
		},
		{
			id: 'terminal',
			label: terminalLabel,
			logo: configuredTerminalLogo,
			disabled: false,
			open: () => {
				onOpen?.( 'terminal' );
				void connector.openSiteInTerminal( site.id ).catch( ( error ) => {
					console.error( 'Failed to open site in terminal:', error );
					captureException( error );
					toast.error( __( 'Could not open the terminal.' ) );
				} );
			},
		},
		{
			id: 'phpmyadmin',
			label: __( 'phpMyAdmin' ),
			logo: databaseLogo,
			disabled: ! site.running,
			open: () => {
				onOpen?.( 'phpmyadmin' );
				void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN, { browser: 'external' } );
				void connector.openSiteUrl( site.id, DATABASE_HOME_PATH ).catch( ( error ) => {
					console.error( 'Failed to open phpMyAdmin:', error );
				} );
			},
		},
	];
}
