import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { code, globe } from '@wordpress/icons';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
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
 * terminal, phpMyAdmin) with their labels, logos, and open handlers. `onOpen`
 * fires only when a destination actually opens — picking the editor without a
 * configured preference navigates to settings instead and reports nothing.
 *
 * The browser destination only appears when the caller provides `browserUrl`
 * (the absolute URL to hand to the external browser, e.g. the preview's
 * current page).
 */
export function useOpenInDestinations(
	site: SiteDetails,
	onOpen?: ( destination: OpenInDestination ) => void,
	browserUrl?: string
): OpenInDestinationEntry[] {
	const connector = useConnector();
	const navigate = useNavigate();
	const { data: userPreferences } = useUserPreferences();
	const openSiteUrl = useOpenSiteUrl( site );
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );

	const busy = isStarting || isStopping;
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

	const browserDestination: OpenInDestinationEntry[] = browserUrl
		? [
				{
					id: 'browser',
					label: __( 'Browser' ),
					logo: globe,
					disabled: ! site.running,
					open: () => {
						onOpen?.( 'browser' );
						void connector.openExternalUrl( browserUrl ).catch( ( error ) => {
							console.error( 'Failed to open site in browser:', error );
						} );
					},
				},
		  ]
		: [];

	return [
		...browserDestination,
		{
			id: 'files',
			label: fileManager.label,
			logo: fileManager.logo,
			disabled: false,
			open: () => {
				onOpen?.( 'files' );
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
			logo: terminalLogo,
			disabled: false,
			open: () => {
				onOpen?.( 'terminal' );
				void connector.openSiteInTerminal( site.id ).catch( ( error ) => {
					console.error( 'Failed to open site in terminal:', error );
				} );
			},
		},
		{
			id: 'phpmyadmin',
			label: __( 'phpMyAdmin' ),
			logo: phpMyAdminLogo,
			disabled: busy,
			open: () => {
				onOpen?.( 'phpmyadmin' );
				void openSiteUrl( '/phpmyadmin/index.php?route=/database/structure&db=wordpress' );
			},
		},
	];
}
