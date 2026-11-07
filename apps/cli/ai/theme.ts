import { initTheme, type Theme } from '@earendil-works/pi-coding-agent';
import { getCapabilities, type TUI } from '@earendil-works/pi-tui';

const THEME_KEY = Symbol.for( '@earendil-works/pi-coding-agent:theme' );

let activeThemeName: 'light' | 'dark' | undefined;

type Rgb = { r: number; g: number; b: number };
type Background = Parameters< Theme[ 'bg' ] >[ 0 ];

// How far each background sits from the terminal's own, toward its text
// colour, and the tint it carries. Pi's themes give fixed colours, drawn for
// one terminal background; set off the terminal's, the rows read as part of
// whatever theme it has.
const BACKGROUNDS: Record< Background, { shift: number; tint?: Rgb } > = {
	userMessageBg: { shift: 0.08 },
	selectedBg: { shift: 0.12 },
	searchMatchBg: { shift: 0.12 },
	customMessageBg: { shift: 0.06, tint: { r: 6, g: 0, b: 12 } },
	toolPendingBg: { shift: 0.04, tint: { r: 0, g: 8, b: 0 } },
	toolSuccessBg: { shift: 0.04, tint: { r: 0, g: 8, b: 0 } },
	toolErrorBg: { shift: 0.04, tint: { r: 16, g: 0, b: 0 } },
};

function luminance( { r, g, b }: Rgb ): number {
	return ( 0.2126 * r + 0.7152 * g + 0.0722 * b ) / 255;
}

/** The background `color` takes on a terminal whose background is `terminal`. */
export function backgroundOn( terminal: Rgb, color: Background ): Rgb {
	const step = BACKGROUNDS[ color ];
	const toward = luminance( terminal ) > 0.5 ? 0 : 255;
	const channel = ( value: number, tint = 0 ) =>
		Math.max( 0, Math.min( 255, Math.round( value + ( toward - value ) * step.shift + tint ) ) );
	return {
		r: channel( terminal.r, step.tint?.r ),
		g: channel( terminal.g, step.tint?.g ),
		b: channel( terminal.b, step.tint?.b ),
	};
}

// Pending-tinted rows can be left stale in scrollback (pi-tui can't repaint
// scrolled-out rows), so pending renders with the success background. With
// the terminal's background known, in truecolor, the backgrounds are set off
// it rather than taken from pi's theme.
let piTheme: Theme | undefined;
function studioBackgrounds( terminal?: Rgb ): void {
	const current = piTheme;
	if ( ! current ) {
		return;
	}
	const ansi = ( color: Background ): string => {
		const shown = color === 'toolPendingBg' ? 'toolSuccessBg' : color;
		const rgb =
			terminal && getCapabilities().trueColor ? backgroundOn( terminal, shown ) : undefined;
		return rgb ? `\x1b[48;2;${ rgb.r };${ rgb.g };${ rgb.b }m` : current.getBgAnsi( shown );
	};
	const studio = Object.create( current ) as Theme;
	studio.getBgAnsi = ansi;
	studio.bg = ( color, text ) => `${ ansi( color ) }${ text }\x1b[49m`;
	( globalThis as Record< symbol, unknown > )[ THEME_KEY ] = studio;
}

// Light or dark from COLORFGBG (`fg;bg`, an ANSI index for the background),
// which some terminals set; dark without it.
function themeFromEnv(): 'light' | 'dark' {
	const background = process.env.COLORFGBG?.split( ';' ).at( -1 )?.trim();
	if ( ! background || ! /^\d{1,2}$/.test( background ) || Number( background ) > 15 ) {
		return 'dark';
	}
	return Number( background ) <= 6 || Number( background ) === 8 ? 'dark' : 'light';
}

// Synchronous env-based light/dark guess; `refineStudioTheme` corrects it.
// pi's own default is its `system` theme, which stays grayscale until the
// terminal's colors reach it, so Studio names its theme.
export function initStudioTheme(): void {
	activeThemeName = themeFromEnv();
	initTheme( activeThemeName );
	piTheme = active();
	studioBackgrounds();
}

// pi-style detection: ask the terminal for its background color. Must run
// after the TUI has started.
export async function refineStudioTheme( tui: TUI ): Promise< boolean > {
	const { background: rgb } = await tui.queryTerminalColors( { timeoutMs: 100 } );
	const detected = rgb ? ( luminance( rgb ) > 0.5 ? 'light' : 'dark' ) : undefined;
	if ( detected && detected !== activeThemeName ) {
		activeThemeName = detected;
		initTheme( detected );
		piTheme = active();
	}
	studioBackgrounds( rgb );
	return Boolean( rgb );
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
