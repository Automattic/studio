import { DEFAULT_ACCENT_COLOR } from '@studio/common/lib/user-settings/preferences';

function luminance( rgb: number[] ): number {
	return rgb.reduce( ( sum, channel, index ) => {
		const value = channel / 255;
		const linear = value <= 0.04045 ? value / 12.92 : ( ( value + 0.055 ) / 1.055 ) ** 2.4;
		return sum + linear * [ 0.2126, 0.7152, 0.0722 ][ index ];
	}, 0 );
}

function contrast( a: number[], b: number[] ): number {
	const first = luminance( a );
	const second = luminance( b );
	return ( Math.max( first, second ) + 0.05 ) / ( Math.min( first, second ) + 0.05 );
}

const color = ( rgb: number[] ) => `rgb(${ rgb.join( ' ' ) })`;

let context: CanvasRenderingContext2D | null;

/**
 * Sets `--accent-fill` to the accent at the lightness closest to the chosen one
 * that keeps text readable on the accent and accent text readable on every
 * surface and accent wash.
 */
export function applyAccentContrast( root: HTMLElement = document.documentElement ): void {
	if ( typeof CanvasRenderingContext2D === 'undefined' ) return;
	if ( ! context ) {
		const canvas = document.createElement( 'canvas' );
		canvas.width = canvas.height = 1;
		context = canvas.getContext( '2d', { willReadFrequently: true } );
	}
	if ( ! context ) return;
	const canvas = context;
	const sample = ( css: string ): number[] => {
		canvas.clearRect( 0, 0, 1, 1 );
		canvas.fillStyle = css;
		canvas.fillRect( 0, 0, 1, 1 );
		return Array.from( canvas.getImageData( 0, 0, 1, 1 ).data ).slice( 0, 3 );
	};
	const style = getComputedStyle( root );
	const hue = style.getPropertyValue( '--accent-hue' ).trim();
	const lightness = Number( style.getPropertyValue( '--accent-lightness' ) );
	const chroma = Number( style.getPropertyValue( '--accent-chroma' ) );
	const hoverLightnessOffset = Number(
		style.getPropertyValue( '--accent-hover-lightness-offset' )
	);
	if ( ! Number.isFinite( lightness ) || ! Number.isFinite( chroma ) ) return;
	const dark =
		root.closest( '[data-color-scheme]' )?.getAttribute( 'data-color-scheme' ) === 'dark';
	if (
		! dark &&
		root.dataset.accentColor === DEFAULT_ACCENT_COLOR &&
		Number( style.getPropertyValue( '--tint-intensity' ) ) === 0 &&
		Number( style.getPropertyValue( '--contrast' ) ) === 0
	) {
		root.style.setProperty( '--accent-fill', DEFAULT_ACCENT_COLOR );
		return;
	}
	const atLightness = ( value: number ) => {
		const saturation = chroma * Math.min( 1, ( 1 - value ) / Math.max( 0.001, 1 - lightness ) );
		return sample( `oklch(${ value } ${ saturation } ${ hue })` );
	};

	const probe = document.createElement( 'span' );
	probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
	root.append( probe );
	const backgrounds: string[] = [];
	let foreground: number[];
	try {
		probe.style.color = 'var(--accent-foreground)';
		foreground = sample( getComputedStyle( probe ).color );
		for ( const token of [
			'--surface-0',
			'--surface-1',
			'--surface-2',
			'--surface-3',
			'--surface-4',
		] ) {
			probe.style.color = `var(${ token })`;
			backgrounds.push( getComputedStyle( probe ).color );
		}
		probe.style.color = 'color-mix(in oklab, var(--foreground) 8%, var(--surface-4))';
		backgrounds.push( getComputedStyle( probe ).color );
	} finally {
		probe.remove();
	}
	const passes = ( lightness: number ) => {
		const accent = atLightness( lightness );
		const hover = sample(
			`oklch(from ${ color( accent ) } calc(l + ${ hoverLightnessOffset }) c h)`
		);
		return (
			contrast( accent, foreground ) >= 4.7 &&
			contrast( hover, foreground ) >= 4.5 &&
			backgrounds.every( ( background, index ) => {
				const surface = sample( background );
				const wash = sample(
					`color-mix(in srgb, ${ color( accent ) } ${ dark ? 15 : 10 }%, ${ background })`
				);
				if ( ! dark )
					return [ surface, wash ].every( ( value ) => contrast( accent, value ) >= 4.7 );
				// Accent text appears on surfaces 0–3; stronger hover surfaces carry indicators.
				return (
					contrast( accent, surface ) >= ( index < 4 ? 4.7 : 3.1 ) &&
					contrast( accent, wash ) >= ( index < 3 ? 4.7 : 3.1 )
				);
			} )
		);
	};
	let resolved = lightness;
	if ( ! passes( resolved ) ) {
		let passing = dark ? 1 : 0;
		let failing = resolved;
		for ( let step = 0; step < 14; step++ ) {
			const middle = ( passing + failing ) / 2;
			if ( passes( middle ) ) passing = middle;
			else failing = middle;
		}
		resolved = passing;
	}
	root.style.setProperty( '--accent-fill', color( atLightness( resolved ) ) );
}
