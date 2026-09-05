import { useEffect, useState } from 'react';

function readScheme(): 'light' | 'dark' {
	return window.matchMedia( '(prefers-color-scheme: dark)' ).matches ? 'dark' : 'light';
}

/**
 * The active color scheme.
 *
 * Authoritative in the desktop app: the main process mirrors the user's saved
 * preference into `nativeTheme.themeSource`, which in turn drives this media
 * query — so it follows the in-app setting, not just the OS one.
 */
export function usePrefersColorScheme(): 'light' | 'dark' {
	const [ scheme, setScheme ] = useState< 'light' | 'dark' >( readScheme );

	useEffect( () => {
		const media = window.matchMedia( '(prefers-color-scheme: dark)' );
		const onChange = ( event: MediaQueryListEvent ) =>
			setScheme( event.matches ? 'dark' : 'light' );
		media.addEventListener( 'change', onChange );
		return () => media.removeEventListener( 'change', onChange );
	}, [] );

	return scheme;
}
