import { describe, it, expect } from 'vitest';
import { computeEdgeGeometry } from './edge-geometry';

describe( 'computeEdgeGeometry', () => {
	it( 'builds the SVG path between two points', () => {
		const g = computeEdgeGeometry( { x: 10, y: 20 }, { x: 30, y: 80 }, 22 );
		expect( g.pathD ).toBe( 'M 10 20 L 30 80' );
	} );

	it( 'returns zero-rotation for a line pointing straight south', () => {
		const g = computeEdgeGeometry( { x: 50, y: 0 }, { x: 50, y: 100 }, 22 );
		expect( Math.round( g.angleDeg ) ).toBe( 0 );
	} );

	it( 'returns -90° rotation for a line pointing east', () => {
		// A south-pointing glyph rotated by angleDeg must end up pointing along the line.
		// angleDeg = Math.atan2(-dx, dy) * 180 / Math.PI.
		// For east: dx>0, dy=0 → atan2(-dx, 0) = -90°.
		const g = computeEdgeGeometry( { x: 0, y: 50 }, { x: 100, y: 50 }, 22 );
		expect( Math.round( g.angleDeg ) ).toBe( -90 );
	} );

	it( 'places push and pull on opposite perpendicular sides of the midpoint', () => {
		// Line from (0,0) → (0,100): perpendicular axis is x.
		const g = computeEdgeGeometry( { x: 0, y: 0 }, { x: 0, y: 100 }, 22 );
		expect( g.midpoint ).toEqual( { x: 0, y: 50 } );
		// push on +perp side (CW-90 of direction), pull on -perp side.
		expect( g.pushCenter.x ).toBeGreaterThan( g.midpoint.x );
		expect( g.pullCenter.x ).toBeLessThan( g.midpoint.x );
		// Equidistant from midpoint.
		expect( Math.abs( g.pushCenter.x - g.midpoint.x ) ).toBeCloseTo( 22 );
		expect( Math.abs( g.pullCenter.x - g.midpoint.x ) ).toBeCloseTo( 22 );
	} );

	it( 'handles zero-length edges without NaN', () => {
		const g = computeEdgeGeometry( { x: 10, y: 10 }, { x: 10, y: 10 }, 22 );
		expect( Number.isFinite( g.angleDeg ) ).toBe( true );
		expect( Number.isFinite( g.pushCenter.x ) ).toBe( true );
		expect( Number.isFinite( g.pushCenter.y ) ).toBe( true );
	} );
} );
