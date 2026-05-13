import { describe, expect, it } from 'vitest';
import { getFittedMediaShapePropsFromDimensions } from './sizing';

describe( 'media widget sizing', () => {
	it( 'keeps the current width and fits height to the natural aspect ratio', () => {
		expect(
			getFittedMediaShapePropsFromDimensions(
				{ w: 320, h: 320 },
				{
					w: 1600,
					h: 900,
				}
			)
		).toEqual( {
			w: 320,
			h: 180,
		} );
	} );

	it( 'ignores invalid dimensions', () => {
		expect( getFittedMediaShapePropsFromDimensions( { w: 320, h: 320 }, null ) ).toBeNull();
		expect(
			getFittedMediaShapePropsFromDimensions( { w: 320, h: 320 }, { w: 0, h: 900 } )
		).toBeNull();
		expect(
			getFittedMediaShapePropsFromDimensions( { w: 0, h: 320 }, { w: 1600, h: 900 } )
		).toBeNull();
	} );
} );
