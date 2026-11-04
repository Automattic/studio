import { initTheme, type Theme } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';

const THEME_KEY = Symbol.for( '@earendil-works/pi-coding-agent:theme' );

let activeThemeName: 'light' | 'dark' | undefined;

// Pending-tinted rows can be left stale in scrollback (pi-tui can't repaint
// scrolled-out rows), so pending renders with the success background.
function equalizePendingBackground(): void {
	const current = active();
	if ( ! current ) {
		return;
	}
	const studio = Object.create( current ) as Theme;
	studio.bg = ( color, text ) =>
		current.bg( color === 'toolPendingBg' ? 'toolSuccessBg' : color, text );
	( globalThis as Record< symbol, unknown > )[ THEME_KEY ] = studio;
}

// COLORFGBG's background index, classified like pi does: 7 and 9-15 are light.
function guessThemeFromEnv(): 'light' | 'dark' {
	const background = Number( process.env.COLORFGBG?.split( ';' ).pop() );
	return background === 7 || ( background >= 9 && background <= 15 ) ? 'light' : 'dark';
}

// Synchronous env-based light/dark guess; `refineStudioTheme` corrects it.
// pi's default "system" theme needs colors only pi's own interactive mode
// reports, so name the built-in light or dark theme.
export function initStudioTheme(): void {
	activeThemeName = guessThemeFromEnv();
	initTheme( activeThemeName );
	equalizePendingBackground();
}

// Ask the terminal for its background color. Must run after the TUI has started.
export async function refineStudioTheme( tui: TUI ): Promise< boolean > {
	const { background } = await tui.queryTerminalColors( { timeoutMs: 100 } );
	let detected: 'light' | 'dark' | undefined;
	if ( background ) {
		const luminance =
			( 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b ) / 255;
		detected = luminance > 0.5 ? 'light' : 'dark';
	}
	if ( ! detected || detected === activeThemeName ) {
		return false;
	}
	activeThemeName = detected;
	initTheme( detected );
	equalizePendingBackground();
	return true;
}

function active(): Theme | undefined {
	return ( globalThis as Record< symbol, unknown > )[ THEME_KEY ] as Theme | undefined;
}

// Facade over pi's theme singleton (not exported from the package root);
// degrades to unstyled text when uninitialized (headless runs, tests).
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
