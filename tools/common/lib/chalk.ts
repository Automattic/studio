/**
 * Minimal chalk-compatible wrapper backed by Node's built-in `util.styleText`.
 *
 * Rationale: `chalk` is an extra dependency for a small feature set that Node
 * 20+ ships natively. See https://e18e.dev/docs/replacements/chalk.html
 *
 * Supports the subset of chalk's API used by Studio's CLI:
 *   - Named styles (foreground, background, modifiers) via `styleText`
 *   - Chained styles: `chalk.bold.red( text )`
 *   - `chalk.hex( '#rrggbb' )( text )` and `chalk.bgHex(...)` via raw
 *     24-bit ANSI escapes (not supported by `styleText`)
 *   - Callable leaves: `chalk.dim( text )` and also `const b = chalk.bold;`
 *
 * Color detection: named styles go through `styleText`, which honors NO_COLOR,
 * FORCE_COLOR, and stream TTY state. The hex path mirrors that by checking
 * `process.stdout.getColorDepth()` (which respects the same env vars) and only
 * emits truecolor escapes when the terminal supports 24-bit color.
 */

import { styleText } from 'node:util';

type Format = Parameters< typeof styleText >[ 0 ];

function supportsTrueColor(): boolean {
	if ( process.env.NO_COLOR ) {
		return false;
	}
	const force = process.env.FORCE_COLOR;
	if ( force === '3' || force === 'true' ) {
		return true;
	}
	if ( force !== undefined ) {
		// FORCE_COLOR is set but not to truecolor — respect the cap.
		return false;
	}
	return ( process.stdout.getColorDepth?.() ?? 1 ) >= 24;
}

function hexToRgb( hex: string ): [ number, number, number ] {
	const h = hex.replace( /^#/, '' );
	return [
		parseInt( h.slice( 0, 2 ), 16 ),
		parseInt( h.slice( 2, 4 ), 16 ),
		parseInt( h.slice( 4, 6 ), 16 ),
	];
}

function wrapHex( hex: string, bg: boolean, text: string ): string {
	if ( ! supportsTrueColor() ) {
		return text;
	}
	const [ r, g, b ] = hexToRgb( hex );
	const open = bg ? 48 : 38;
	const close = bg ? 49 : 39;
	return `\x1b[${ open };2;${ r };${ g };${ b }m${ text }\x1b[${ close }m`;
}

type ChalkFn = ( ( text: string ) => string ) & {
	[ key: string ]: ChalkFn;
} & {
	hex: ( color: string ) => ChalkFn;
	bgHex: ( color: string ) => ChalkFn;
};

function createChalk( formats: readonly string[], hexFg?: string, hexBg?: string ): ChalkFn {
	const fn = ( ( text: string ) => {
		let out = formats.length > 0 ? styleText( formats as unknown as Format, text ) : text;
		if ( hexFg ) {
			out = wrapHex( hexFg, false, out );
		}
		if ( hexBg ) {
			out = wrapHex( hexBg, true, out );
		}
		return out;
	} ) as ChalkFn;

	return new Proxy( fn, {
		get( target, prop ) {
			if ( typeof prop !== 'string' ) {
				return Reflect.get( target, prop );
			}
			if ( prop === 'hex' ) {
				return ( color: string ) => createChalk( formats, color, hexBg );
			}
			if ( prop === 'bgHex' ) {
				return ( color: string ) => createChalk( formats, hexFg, color );
			}
			return createChalk( [ ...formats, prop ], hexFg, hexBg );
		},
	} );
}

const chalk = createChalk( [] );
export default chalk;
