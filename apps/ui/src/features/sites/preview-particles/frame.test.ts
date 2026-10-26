import { expect, it } from 'vitest';
import { createPreviewDots, getPreviewDotFrame } from './frame';

it( 'keeps a moving dot within one grid spacing of the center without a logo', () => {
	const [ width, height ] = [ 800, 600 ];
	const dots = createPreviewDots( width, height );
	const spacing = dots[ 1 ].x - dots[ 0 ].x;
	for ( let time = 0; time <= 14000; time += 250 ) {
		const distances = dots.map( ( dot ) => {
			const { x, y } = getPreviewDotFrame( dot, {
				time,
				amount: 1,
				centerX: width / 2,
				centerY: height / 2,
				clearCenter: false,
			} );
			return Math.hypot( x - width / 2, y - height / 2 );
		} );
		expect( Math.min( ...distances ) ).toBeLessThan( spacing );
	}
} );
