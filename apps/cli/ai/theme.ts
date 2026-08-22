import { initTheme, type Theme } from '@earendil-works/pi-coding-agent';

const THEME_KEY = Symbol.for( '@earendil-works/pi-coding-agent:theme' );

// pi resolves the light/dark theme from the terminal itself.
export function initStudioTheme(): void {
	initTheme();
}

function active(): Theme | undefined {
	return ( globalThis as Record< symbol, unknown > )[ THEME_KEY ] as Theme | undefined;
}

// Facade over pi's theme singleton, which isn't exported from the package
// root. Resolves the instance per call and degrades to unstyled text when no
// theme is initialized (headless runs, unit tests).
export const theme = {
	fg: ( color: Parameters< Theme[ 'fg' ] >[ 0 ], text: string ) =>
		active()?.fg( color, text ) ?? text,
	bg: ( color: Parameters< Theme[ 'bg' ] >[ 0 ], text: string ) =>
		active()?.bg( color, text ) ?? text,
	bold: ( text: string ) => active()?.bold( text ) ?? text,
	italic: ( text: string ) => active()?.italic( text ) ?? text,
	underline: ( text: string ) => active()?.underline( text ) ?? text,
	inverse: ( text: string ) => active()?.inverse( text ) ?? text,
	strikethrough: ( text: string ) => active()?.strikethrough( text ) ?? text,
};
