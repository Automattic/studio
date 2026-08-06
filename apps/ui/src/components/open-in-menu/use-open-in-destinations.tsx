import { captureException } from '@studio/common/lib/error-reporting';
import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { code, external } from '@wordpress/icons';
import { useConnector } from '@/data/core';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { editorLogos, finderLogo, folderLogo, terminalLogo, terminalLogos } from '@/lib/logos';
import type { SiteDetails } from '@/data/core';
import type { ReactElement } from 'react';

export type OpenInDestination = 'browser' | 'files' | 'editor' | 'terminal';

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
 * terminal) with their labels, logos, and open handlers.
 *
 * `browserPath` is the site-relative path the browser opens — the preview's
 * current page, not the site root. `onOpen` fires only when a destination
 * actually opens: picking the editor without a configured preference
 * navigates to settings instead and reports nothing.
 *
 * Browser is the only destination that needs a running site; the rest work
 * stopped.
 */
export function useOpenInDestinations(
	site: SiteDetails,
	browserPath: string,
	onOpen?: ( destination: OpenInDestination ) => void
): OpenInDestinationEntry[] {
	const connector = useConnector();
	const navigate = useNavigate();
	const { data: userPreferences } = useUserPreferences();

	const fileManager = getFileManager();
	const editorLabel = userPreferences?.editor
		? supportedEditorConfig[ userPreferences.editor ].label
		: __( 'Editor' );
	const editorLogo = userPreferences?.editor ? editorLogos[ userPreferences.editor ] : undefined;
	const terminalLabel = userPreferences?.terminal
		? terminalConfig[ userPreferences.terminal ].name
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
				// Routed through the host rather than `openExternalUrl` so the
				// URL goes via /studio-auto-login; opening it raw drops the
				// session and lands admin screens on the login form.
				void connector.openSiteUrl( site.id, browserPath ).catch( ( error ) => {
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
					alert( __( 'Could not open the terminal.' ) );
				} );
			},
		},
	];
}
