import { initTheme, type Theme } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';

const THEME_KEY = Symbol.for( '@earendil-works/pi-coding-agent:theme' );

let activeThemeName: 'light' | 'dark' | undefined;

// Environment-based light/dark guess, synchronously, so the first render is
// already close; `refineStudioTheme` corrects it by asking the terminal.
export function initStudioTheme(): void {
	initTheme();
}

// Mirrors pi's startup detection: query the terminal's reported color scheme,
// fall back to its background color. Must run after the TUI has started.
export async function refineStudioTheme( tui: TUI ): Promise< boolean > {
	let detected = await tui.queryTerminalColorScheme( { timeoutMs: 100 } );
	if ( ! detected ) {
		const rgb = await tui.queryTerminalBackgroundColor( { timeoutMs: 100 } );
		if ( rgb ) {
			const luminance = ( 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b ) / 255;
			detected = luminance > 0.5 ? 'light' : 'dark';
		}
	}
	if ( ! detected || detected === activeThemeName ) {
		return false;
	}
	activeThemeName = detected;
	initTheme( detected );
	return true;
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
