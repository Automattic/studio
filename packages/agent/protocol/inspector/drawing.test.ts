import { describe, expect, it } from 'vitest';
import { createDrawingGeometry } from './drawing';

const { pathData, recognizeEllipse } = createDrawingGeometry();
const ellipse = ( rx: number, ry: number, rotation = 0, noise = 0, turns = 1 ) =>
	Array.from( { length: 81 }, ( _, i ) => {
		const angle = ( i / 80 ) * Math.PI * 2 * turns;
		const wobble = 1 + noise * Math.sin( angle * 5 ) + noise * 0.3 * Math.cos( angle * 9 );
		const x = rx * Math.cos( angle ) * wobble,
			y = ry * Math.sin( angle ) * wobble;
		return {
			x: 200 + x * Math.cos( rotation ) - y * Math.sin( rotation ),
			y: 200 + x * Math.sin( rotation ) + y * Math.cos( rotation ),
		};
	} );

describe( 'drawing geometry', () => {
	it( 'smooths a stroke with curves while preserving its endpoints and extent', () => {
		const path = pathData( [
			{ x: 10, y: 20 },
			{ x: 20, y: 40 },
			{ x: 40, y: 25 },
			{ x: 60, y: 30 },
		] );
		expect( path ).toMatch( /^M10 20Q/ );
		expect( path ).toMatch( /60 30$/ );
		expect( path ).not.toContain( 'L' );
	} );
	it( 'keeps dots and short lines visible', () => {
		expect( pathData( [] ) ).toBe( '' );
		expect( pathData( [ { x: 10, y: 20 } ] ) ).toContain( 'l0.01 0' );
		expect(
			pathData( [
				{ x: 10, y: 20 },
				{ x: 30, y: 40 },
			] )
		).toBe( 'M10 20L30 40' );
	} );
	it.each( [
		[ 60, 60, 0 ],
		[ 100, 40, 0 ],
		[ 100, 40, Math.PI / 4 ],
		[ 30, 90, -0.6 ],
	] )( 'recognizes a rough ellipse with radii %s, %s and rotation %s', ( rx, ry, rotation ) => {
		const shape = recognizeEllipse( ellipse( rx, ry, rotation, 0.055 ) );
		expect( shape ).not.toBeNull();
		expect( shape ).toHaveLength( 65 );
		expect( shape![ 0 ] ).toEqual( shape!.at( -1 ) );
		expect( pathData( shape! ) ).toMatch( /Z$/ );
		for ( const p of shape! ) {
			const x = ( p.x - 200 ) * Math.cos( rotation ) + ( p.y - 200 ) * Math.sin( rotation );
			const y = -( p.x - 200 ) * Math.sin( rotation ) + ( p.y - 200 ) * Math.cos( rotation );
			expect( Math.hypot( x / rx, y / ry ) ).toBeGreaterThan( 0.85 );
			expect( Math.hypot( x / rx, y / ry ) ).toBeLessThan( 1.15 );
		}
	} );
	it( 'recognizes clockwise and counterclockwise circles, including a small closing gap', () => {
		expect( recognizeEllipse( ellipse( 60, 60 ).reverse() ) ).not.toBeNull();
		expect( recognizeEllipse( ellipse( 60, 60, 0, 0, 0.96 ) ) ).not.toBeNull();
	} );
	it.each(
		[
			ellipse( 60, 60, 0, 0, 0.75 ),
			ellipse( 60, 60, 0, 0, 2 ),
			ellipse( 5, 5 ),
			ellipse( 100, 5 ),
			Array.from( { length: 30 }, ( _, i ) => ( { x: 20 + i * 4, y: 40 } ) ),
			Array.from( { length: 81 }, ( _, i ) => ( {
				x: 200 + Math.sin( ( i / 80 ) * Math.PI * 2 ) * 60,
				y: 200 + Math.sin( ( i / 80 ) * Math.PI * 4 ) * 50,
			} ) ),
			[
				...ellipse( 60, 60 ).slice( 0, 40 ),
				...ellipse( 60, 60 ).slice( 10, 40 ).reverse(),
				...ellipse( 60, 60 ).slice( 10 ),
			],
		].map( ( points ) => ( { points } ) )
	)( 'keeps ambiguous, open, tiny and retraced strokes freehand (%#)', ( { points } ) => {
		expect( recognizeEllipse( points ) ).toBeNull();
	} );
	it.each( [
		[ 50, 50 ],
		[ 100, 30 ],
	] )( 'keeps rectangles freehand (%s by %s)', ( x, y ) => {
		const corners = [
			{ x: 200 - x, y: 200 - y },
			{ x: 200 + x, y: 200 - y },
			{ x: 200 + x, y: 200 + y },
			{ x: 200 - x, y: 200 + y },
		];
		const points = corners.flatMap( ( a, edge ) =>
			Array.from( { length: 20 }, ( _, i ) => {
				const b = corners[ ( edge + 1 ) % corners.length ];
				return { x: a.x + ( ( b.x - a.x ) * i ) / 20, y: a.y + ( ( b.y - a.y ) * i ) / 20 };
			} )
		);
		points.push( corners[ 0 ] );
		expect( recognizeEllipse( points ) ).toBeNull();
	} );
} );
