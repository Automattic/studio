import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';

// Route through the connector (host clipboard) — the renderer's
// `navigator.clipboard` is denied in the Electron desktop, which leaves a
// direct copy silently failing and the button stuck on "Copy".
export function useCopyText( text: string ): { copied: boolean; copy: () => void } {
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

	const copy = useCallback( () => {
		void connector
			.copyText( text )
			.then( () => {
				setCopied( true );
				// Re-arm the reset on every click so copying again mid-"Copied"
				// doesn't let the earlier timer flip the state back too soon.
				if ( resetTimer.current ) {
					clearTimeout( resetTimer.current );
				}
				resetTimer.current = setTimeout( () => setCopied( false ), 2000 );
			} )
			.catch( ( error ) => {
				console.error( 'Failed to copy text:', error );
			} );
	}, [ connector, text ] );

	return { copied, copy };
}
