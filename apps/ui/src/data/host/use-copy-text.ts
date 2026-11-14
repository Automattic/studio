import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dismissToast, errorMessage, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';

// Route through the connector (host clipboard) — the renderer's
// `navigator.clipboard` is denied in the Electron desktop, which leaves a
// direct copy silently failing and the button stuck on "Copy".
export function useCopyText(
	text: string,
	successMessage?: string
): { copied: boolean; copy: () => void } {
	const connector = useConnector();
	const [ copiedText, setCopiedText ] = useState< string >();
	const resetTimer = useRef< ReturnType< typeof setTimeout > | null >( null );

	useEffect( () => {
		return () => {
			if ( resetTimer.current ) {
				clearTimeout( resetTimer.current );
			}
		};
	}, [] );

	const copy = useCallback( () => {
		void connector
			.copyText( text )
			.then( () => {
				dismissToast( 'clipboard-error' );
				if ( successMessage ) toast.success( successMessage, { id: 'clipboard-success' } );
				setCopiedText( text );
				// Re-arm the reset on every click so copying again mid-"Copied"
				// doesn't let the earlier timer flip the state back too soon.
				if ( resetTimer.current ) {
					clearTimeout( resetTimer.current );
				}
				resetTimer.current = setTimeout( () => setCopiedText( undefined ), 2000 );
			} )
			.catch( ( error ) => {
				toast.error( __( 'Could not copy' ), {
					id: 'clipboard-error',
					description: errorMessage( error ),
				} );
			} );
	}, [ connector, text, successMessage ] );

	return { copied: copiedText === text, copy };
}
