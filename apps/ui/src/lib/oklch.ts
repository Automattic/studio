// sRGB hex ↔ OKLCH (Björn Ottosson's OKLab), for tinting the theme's seeds.

const toLinear = ( channel: number ) =>
	channel <= 0.04045 ? channel / 12.92 : ( ( channel + 0.055 ) / 1.055 ) ** 2.4;
const toGamma = ( channel: number ) =>
	channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** ( 1 / 2.4 ) - 0.055;

export function hexToOklch( hex: string ): { l: number; c: number; h: number } {
	const [ r, g, b ] = [ 1, 3, 5 ].map( ( index ) =>
		toLinear( parseInt( hex.slice( index, index + 2 ), 16 ) / 255 )
	);
	const l = Math.cbrt( 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b );
	const m = Math.cbrt( 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b );
	const s = Math.cbrt( 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b );
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		c: Math.hypot( a, bb ),
		h: ( ( Math.atan2( bb, a ) * 180 ) / Math.PI + 360 ) % 360,
	};
}

export function oklchToHex( { l: lightness, c, h }: { l: number; c: number; h: number } ) {
	const a = c * Math.cos( ( h * Math.PI ) / 180 );
	const b = c * Math.sin( ( h * Math.PI ) / 180 );
	const l = ( lightness + 0.3963377774 * a + 0.2158037573 * b ) ** 3;
	const m = ( lightness - 0.1055613458 * a - 0.0638541728 * b ) ** 3;
	const s = ( lightness - 0.0894841775 * a - 1.291485548 * b ) ** 3;
	return (
		'#' +
		[
			4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
			-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
			-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
		]
			.map( ( channel ) =>
				Math.round( Math.min( 1, Math.max( 0, toGamma( channel ) ) ) * 255 )
					.toString( 16 )
					.padStart( 2, '0' )
			)
			.join( '' )
	);
}
