import { hexToOklch } from './color';

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
const overrides = [
	'--accent-fill',
	'--accent-hover-fill',
	'--accent-subtle-foreground-fill',
	'--accent-subtle-hover-foreground-fill',
] as const;

let context: CanvasRenderingContext2D | null;

/** Adjust fills and text independently so a readable link never lightens its button. */
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
	for ( const token of overrides ) root.style.removeProperty( token );
	const probe = document.createElement( 'span' );
	probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
	root.append( probe );
	const read = ( css: string ) => {
		probe.style.color = css;
		return sample( getComputedStyle( probe ).color );
	};
	try {
		const dark =
			root.closest( '[data-color-scheme]' )?.getAttribute( 'data-color-scheme' ) === 'dark';
		const foreground = read( 'var(--accent-foreground)' );
		const subtleBackgrounds = [
			read( 'var(--accent-subtle)' ),
			read( 'var(--accent-subtle-hover)' ),
		];
		const adjust = ( desired: number[], text: boolean ) => {
			const passes = ( rgb: number[] ) =>
				( text ? subtleBackgrounds : [ foreground ] ).every( ( bg ) => contrast( rgb, bg ) >= 4.7 );
			if ( passes( desired ) ) return desired;
			const hex = `#${ desired
				.map( ( channel ) => channel.toString( 16 ).padStart( 2, '0' ) )
				.join( '' ) }`;
			const { l, c, h } = hexToOklch( hex );
			const atLightness = ( value: number ) => {
				const chroma = c * Math.min( 1, ( 1 - value ) / Math.max( 0.001, 1 - l ) );
				return sample( `oklch(${ value } ${ chroma } ${ h })` );
			};
			let passing = text && dark ? 1 : 0;
			let failing = l;
			for ( let step = 0; step < 14; step++ ) {
				const middle = ( passing + failing ) / 2;
				if ( passes( atLightness( middle ) ) ) passing = middle;
				else failing = middle;
			}
			return atLightness( passing );
		};
		const colors = [
			'--accent',
			'--accent-hover',
			'--accent-text-base',
			'--accent-text-hover-base',
		].map( ( token, index ) => adjust( read( `var(${ token })` ), index >= 2 ) );
		overrides.forEach( ( token, index ) =>
			root.style.setProperty( token, color( colors[ index ] ) )
		);
	} finally {
		probe.remove();
	}
}
