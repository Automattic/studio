export function hexToOklch( hex: string ): { l: number; c: number; h: number } {
	const [ r, g, b ] = [ 1, 3, 5 ].map( ( index ) => {
		const value = parseInt( hex.slice( index, index + 2 ), 16 ) / 255;
		return value <= 0.04045 ? value / 12.92 : ( ( value + 0.055 ) / 1.055 ) ** 2.4;
	} );
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
