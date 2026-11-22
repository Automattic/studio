import { __ } from '@wordpress/i18n';
import { useRef, useState, type RefObject } from 'react';
import { showToast } from '@/data/app-messages';
import type { WebviewTag } from './preview-surface/webview';

export function usePreviewScreenshot(
	viewportRef: RefObject< HTMLDivElement | null >,
	onScreenshot?: ( file: File ) => void
) {
	const [ capturing, setCapturing ] = useState( false );
	const pending = useRef( false );

	const capture = async () => {
		if ( pending.current || ! onScreenshot ) return;
		pending.current = true;
		setCapturing( true );
		try {
			const webview = [
				...( viewportRef.current?.querySelectorAll< WebviewTag >( 'webview' ) ?? [] ),
			].find( ( element ) => ! element.closest( '[inert]' ) );
			if ( ! webview ) throw new Error( 'Preview is not available.' );
			const image = await webview.capturePage();
			if ( image.isEmpty() ) throw new Error( 'The screenshot is empty.' );
			const data = atob( image.toDataURL().split( ',' )[ 1 ] );
			onScreenshot(
				new File(
					[ Uint8Array.from( data, ( character ) => character.charCodeAt( 0 ) ) ],
					`screenshot-${ new Date().toISOString().replace( /[:.]/g, '-' ) }.png`,
					{ type: 'image/png' }
				)
			);
		} catch {
			showToast( { intent: 'error', title: __( 'Could not take screenshot' ) } );
		} finally {
			pending.current = false;
			setCapturing( false );
		}
	};

	return { capturing, capture };
}
