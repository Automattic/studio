import { describe, expect, it } from 'vitest';
import { MAX_DRAWING_POINTS, parseInspectorSelection, type InspectorSelection } from './selection';

const selection: InspectorSelection = {
	id: 'selection',
	target: {
		kind: 'region',
		url: 'http://localhost:8881/',
		viewport: { width: 800, height: 600 },
		documentRect: { left: 10, top: 120, width: 300, height: 200 },
	},
	rect: { left: 10, top: 20, width: 300, height: 200 },
	scroll: { left: 0, top: 100 },
};

describe( 'inspector selections', () => {
	it( 'accepts an area without an element selector and preserves page geometry', () => {
		expect( parseInspectorSelection( selection ) ).toMatchObject( selection );
	} );
	it.each( [
		{ rect: { left: -1, top: 20, width: 300, height: 200 } },
		{ rect: { left: 10, top: 20, width: 1000, height: 200 } },
		{ rect: { left: 10, top: 20, width: NaN, height: 200 } },
		{ scroll: { left: 0, top: 400 } },
	] )( 'rejects invalid or inconsistent capture geometry: %j', ( patch ) => {
		expect( parseInspectorSelection( { ...selection, ...patch } ) ).toBeNull();
	} );
	it( 'bounds drawing data and rejects points outside its viewport', () => {
		const input = {
			...selection,
			target: { ...selection.target, kind: 'drawing' },
			drawing: { width: 3, color: 'oklch(.5 .2 260)', strokes: [ [ { x: 20, y: 130 } ] ] },
		};
		expect( parseInspectorSelection( input )?.drawing ).toEqual( input.drawing );
		expect(
			parseInspectorSelection( {
				...input,
				drawing: { ...input.drawing, strokes: [ [ { x: 900, y: 130 } ] ] },
			} )
		).toBeNull();
		expect(
			parseInspectorSelection( {
				...input,
				drawing: {
					...input.drawing,
					strokes: [
						Array.from( { length: MAX_DRAWING_POINTS + 1 }, () => ( { x: 20, y: 130 } ) ),
					],
				},
			} )
		).toBeNull();
	} );
} );
