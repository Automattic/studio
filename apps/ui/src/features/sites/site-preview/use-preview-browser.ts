import { browserConfig } from '@studio/common/lib/user-settings/browser';
import { __ } from '@wordpress/i18n';
import { useState, type RefObject } from 'react';
import { showToast } from '@/data/app-messages';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import {
	clearPreviewRecentLocations,
	setPreviewColorScheme,
	usePreviewColorScheme,
} from './preview-browser-settings';
import {
	getPreviewIpc,
	getWebviewContentsId,
	isElectron,
	type WebviewTag,
} from './preview-surface/webview';
import type { PreviewBrowserActions } from './preview-header/browser-menu';

export function usePreviewBrowser( viewportRef: RefObject< HTMLDivElement | null > ) {
	const colorScheme = usePreviewColorScheme();
	const { data: preferences } = useUserPreferences();
	const { data: installedApps } = useInstalledApps();
	const [ clearing, setClearing ] = useState( false );
	const getActiveContentsId = () => {
		const webview = [
			...( viewportRef.current?.querySelectorAll< WebviewTag >( 'webview' ) ?? [] ),
		].find( ( element ) => ! element.closest( '[inert]' ) );
		if ( ! webview ) throw new Error( 'Preview is not available.' );
		return getWebviewContentsId( webview );
	};
	const actions: PreviewBrowserActions = {
		colorScheme,
		browser: preferences?.browser ?? installedApps?.defaultBrowser?.browser,
		browserName: preferences?.browser
			? browserConfig[ preferences.browser ].name
			: installedApps?.defaultBrowser?.name,
		clearing,
	};
	if ( ! isElectron() ) return actions;
	return {
		...actions,
		onColorSchemeChange: setPreviewColorScheme,
		onOpenDevTools: () => {
			void ( async () => {
				try {
					await getPreviewIpc()!.openWebviewDevTools!( getActiveContentsId() );
				} catch {
					showToast( { intent: 'error', title: __( 'Could not open DevTools' ) } );
				}
			} )();
		},
		onClearBrowsingData: () => {
			if ( clearing ) return;
			setClearing( true );
			void ( async () => {
				try {
					await getPreviewIpc()!.clearWebviewBrowsingData!( getActiveContentsId() );
					clearPreviewRecentLocations();
					showToast( { title: __( 'Browsing data cleared' ) } );
				} catch {
					showToast( { intent: 'error', title: __( 'Could not clear browsing data' ) } );
				} finally {
					setClearing( false );
				}
			} )();
		},
	};
}
