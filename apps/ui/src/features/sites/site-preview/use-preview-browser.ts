import { __ } from '@wordpress/i18n';
import { useState, type RefObject } from 'react';
import { showToast } from '@/data/app-messages';
import {
	clearPreviewRecentLocations,
	setPreviewColorScheme,
	usePreviewColorScheme,
} from './preview-browser-settings';
import { getPreviewIpc, getWebviewContentsId, type WebviewTag } from './preview-surface/webview';
import type { PreviewBrowserActions } from './preview-header/browser-menu';

export function usePreviewBrowser( viewportRef: RefObject< HTMLDivElement | null > ) {
	const colorScheme = usePreviewColorScheme();
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
		onColorSchemeChange: setPreviewColorScheme,
		clearing,
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
	return actions;
}
