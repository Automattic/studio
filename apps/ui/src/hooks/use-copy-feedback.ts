import { useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';

const COPIED_RESET_MS = 2000;

/**
 * Shared "copy to clipboard, flip to a copied state for a couple seconds"
 * state machine used by every copy-a-credential control (CopyButton, and the
 * inline copy-on-click text in the Site Overview About card).
 */
export function useCopyFeedback( value: string ) {
	const connector = useConnector();
	const [ copied, setCopied ] = useState( false );
	const resetTimer = useRef< ReturnType< typeof setTimeout > | null >( null );

	useEffect( () => {
		return () => {
			if ( resetTimer.current ) {
				clearTimeout( resetTimer.current );
			}
		};
	}, [] );

	const copy = () => {
		void connector
			.copyText( value )
			.then( () => {
				setCopied( true );
				// Re-arm the reset on every call so copying again mid-"Copied"
				// doesn't let the earlier timer flip the state back too soon.
				if ( resetTimer.current ) {
					clearTimeout( resetTimer.current );
				}
				resetTimer.current = setTimeout( () => setCopied( false ), COPIED_RESET_MS );
			} )
			.catch( ( error ) => {
				console.error( 'Failed to copy text:', error );
			} );
	};

	return { copied, copy };
}
