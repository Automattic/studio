import { useEffect, useState } from 'react';

export function usePrefersColorScheme(): 'light' | 'dark' {
	const [ scheme, setScheme ] = useState< 'light' | 'dark' >( () => {
		if ( typeof window === 'undefined' ) {
			return 'light';
		}
		return window.matchMedia( '(prefers-color-scheme: dark)' ).matches ? 'dark' : 'light';
	} );

	useEffect( () => {
		const media = window.matchMedia( '(prefers-color-scheme: dark)' );
		const onChange = ( e: MediaQueryListEvent ) => setScheme( e.matches ? 'dark' : 'light' );
		media.addEventListener( 'change', onChange );
		return () => media.removeEventListener( 'change', onChange );
	}, [] );

	return scheme;
}
