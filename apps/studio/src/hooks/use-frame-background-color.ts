import { useEffect, useState } from 'react';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function readFrameBackgroundColor(): string {
	const value = getComputedStyle( document.documentElement )
		.getPropertyValue( '--color-frame-bg' )
		.trim();
	// jsdom resolves no custom properties; the light value keeps tests honest.
	return value || '#fff';
}

/**
 * Studio's current frame background, read from `--color-frame-bg` so the two
 * never drift.
 *
 * Feed this to `@wordpress/ui`'s `ThemeProvider` as its `color.bg` seed: WPDS
 * derives its whole ramp from that seed, and without one it falls back to the
 * light-only values built into `@wordpress/theme` — which is why a WPDS
 * component renders a light card on Studio's dark chrome.
 */
export function useFrameBackgroundColor(): string {
	const [ backgroundColor, setBackgroundColor ] = useState( readFrameBackgroundColor );

	useEffect( () => {
		const query = window.matchMedia( DARK_SCHEME_QUERY );
		const update = () => setBackgroundColor( readFrameBackgroundColor() );
		query.addEventListener( 'change', update );
		return () => query.removeEventListener( 'change', update );
	}, [] );

	return backgroundColor;
}
