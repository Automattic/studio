import { describe, expect, it } from 'vitest';
import {
	createPreviewDots,
	getPreviewDotFrame,
	getSelectionWave,
	SELECTION_WAVE_DURATION,
} from './frame';

describe( 'preview particle frames', () => {
	it( 'opens the space for the logo gradually without moving a resting dot', () => {
		const dot = createPreviewDots( 1, 1 )[ 0 ];
		const frame = { time: 0, amount: 0, centerX: 0.5, centerY: 0.5 };
		const resting = getPreviewDotFrame( dot, { ...frame, logoAmount: 0 } );
		const opening = getPreviewDotFrame( dot, { ...frame, logoAmount: 0.5 } );
		const cleared = getPreviewDotFrame( dot, { ...frame, logoAmount: 1 } );
		expect( opening.x ).toBe( resting.x );
		expect( opening.y ).toBe( resting.y );
		expect( opening.opacity ).toBeGreaterThan( cleared.opacity );
		expect( opening.opacity ).toBeLessThan( resting.opacity );
	} );

	it( 'lights the selected-site grid downward in an upward arch with the sides leading', () => {
		const dots = createPreviewDots( 800, 600 );
		const top = dots.reduce( ( closest, dot ) =>
			Math.hypot( dot.x - 400, dot.y - 100 ) < Math.hypot( closest.x - 400, closest.y - 100 )
				? dot
				: closest
		);
		const bottom = { ...top, y: 500 };
		const side = { ...bottom, x: 18 };
		const wave = ( dot: typeof top, elapsed: number ) =>
			getSelectionWave( dot, {
				elapsed: ( elapsed * SELECTION_WAVE_DURATION ) / 1000,
				height: 600,
				centerX: 400,
			} );
		expect( wave( top, 350 ) ).toBeGreaterThan( 0.9 );
		expect( wave( bottom, 230 ) ).toBe( 0 );
		expect( wave( top, 650 ) ).toBe( 0 );
		expect( wave( bottom, 770 ) ).toBeGreaterThan( 0.9 );
		expect( wave( side, 650 ) ).toBeGreaterThan( wave( bottom, 650 ) );
	} );

	it( 'leaves no selection highlight before or after the single sweep', () => {
		for ( const dot of createPreviewDots( 800, 600 ) ) {
			for ( const elapsed of [ -1, 0, SELECTION_WAVE_DURATION, 5000 ] ) {
				expect( getSelectionWave( dot, { elapsed, height: 600, centerX: 400 } ) ).toBe( 0 );
			}
		}
	} );

	it( 'keeps the outer dots anchored while interior dots move', () => {
		const dots = createPreviewDots( 800, 600 );
		const frame = { time: 2400, amount: 1, centerX: 400, centerY: 300, logoAmount: 0 };
		for ( const dot of dots.filter( ( point ) => point.edge === 0 ) ) {
			const point = getPreviewDotFrame( dot, frame );
			expect( point.x ).toBeCloseTo( dot.x );
			expect( point.y ).toBeCloseTo( dot.y );
		}
		const interior = dots.find( ( dot ) => dot.edge === 1 )!;
		expect( getPreviewDotFrame( interior, frame ).x ).not.toBe( interior.x );
	} );

	it( 'reproduces the same positions and opacity when seeking back to a frame', () => {
		const dots = createPreviewDots( 960, 600 );
		const frame = { time: 1234, amount: 1, centerX: 480, centerY: 300, logoAmount: 0 };
		const before = dots.map( ( dot ) => getPreviewDotFrame( dot, frame ) );
		dots.forEach( ( dot ) => getPreviewDotFrame( dot, { ...frame, time: 9000 } ) );
		expect( dots.map( ( dot ) => getPreviewDotFrame( dot, frame ) ) ).toEqual( before );
	} );

	it( 'fills the whole idle grid and only clears the center when the logo is visible', () => {
		for ( const size of [ 1, 20, 600 ] ) {
			const dots = createPreviewDots( size, size );
			for ( const dot of dots ) {
				const point = getPreviewDotFrame( dot, {
					time: 0,
					amount: 0,
					centerX: size / 2,
					centerY: size / 2,
					logoAmount: 0,
				} );
				expect( Number.isFinite( point.x + point.y + point.opacity ) ).toBe( true );
				expect( point.opacity ).toBeCloseTo( 0.2 );
				if ( Math.hypot( point.x - size / 2, point.y - size / 2 ) <= 36 ) {
					expect(
						getPreviewDotFrame( dot, {
							time: 0,
							amount: 0,
							centerX: size / 2,
							centerY: size / 2,
							logoAmount: 1,
						} ).opacity
					).toBe( 0 );
				}
			}
		}
	} );

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
					logoAmount: 0,
				} );
				return Math.hypot( x - width / 2, y - height / 2 );
			} );
			expect( Math.min( ...distances ) ).toBeLessThan( spacing );
		}
	} );
} );
