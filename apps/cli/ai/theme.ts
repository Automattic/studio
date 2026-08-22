import { initTheme, type Theme } from '@earendil-works/pi-coding-agent';

const THEME_KEYS = [
	Symbol.for( '@earendil-works/pi-coding-agent:theme' ),
	Symbol.for( '@mariozechner/pi-coding-agent:theme' ),
];

// pi paints tool blocks with pending/success background tints that clash with
// Studio's otherwise unstyled transcript. Wrap the active theme to drop those
// two backgrounds while keeping the error tint and everything else.
export function initStudioTheme(): void {
	initTheme();
	const store = globalThis as Record< symbol, unknown >;
	const active = store[ THEME_KEYS[ 0 ] ] as Theme;
	const studio = Object.create( active ) as Theme;
	studio.bg = ( color, text ) =>
		color === 'toolPendingBg' || color === 'toolSuccessBg' ? text : active.bg( color, text );
	for ( const key of THEME_KEYS ) {
		store[ key ] = studio;
	}
}
