import { describe, expect, it } from 'vitest';
import { MAX_DRAWING_POINTS, parseInspectorSelection, type InspectorSelection } from './selection';

const selection: InspectorSelection = {
	id: 'selection',
	target: {
		kind: 'drawing',
		url: 'http://localhost:8881/',
		viewport: { width: 800, height: 600 },
		documentRect: { left: 10, top: 120, width: 300, height: 200 },
	},
	rect: { left: 10, top: 20, width: 300, height: 200 },
	scroll: { left: 0, top: 100 },
	drawing: { width: 3, color: '#3858e9', strokes: [ [ { x: 20, y: 130 } ] ] },
};

describe( 'inspector selections', () => {
	it.each( [ 'region', 'drawing' ] as const )(
		'accepts a %s without an element selector and preserves page geometry',
		( kind ) => {
			const { drawing, ...area } = selection;
			const input = {
				...area,
				target: { ...selection.target, kind },
				...( kind === 'drawing' ? { drawing } : {} ),
			};
			expect( parseInspectorSelection( input ) ).toMatchObject( input );
		}
	);
	it.each( [
		{ rect: { left: -1, top: 20, width: 300, height: 200 } },
		{ rect: { left: 10, top: 20, width: 1000, height: 200 } },
		{ rect: { left: 10, top: 20, width: NaN, height: 200 } },
		{ rect: { left: 10.5, top: 20, width: 300, height: 200 } },
		{ scroll: { left: 0, top: 400 } },
		{ target: { ...selection.target, kind: 'region' } },
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
	it( 'preserves a shape undo and bounds the original points as part of the drawing', () => {
		const input = {
			...selection,
			replaces: 'note',
			target: { ...selection.target, kind: 'drawing' },
			drawing: {
				width: 3,
				color: '#3858e9',
				strokes: [
					[
						{ x: 30, y: 140 },
						{ x: 60, y: 180 },
					],
				],
				originalStroke: [
					{ x: 25, y: 135 },
					{ x: 65, y: 185 },
				],
			},
		};
		expect( parseInspectorSelection( input ) ).toMatchObject( {
			replaces: 'note',
			drawing: input.drawing,
		} );
		for ( const originalStroke of [
			[],
			[ { x: 900, y: 140 } ],
			Array.from( { length: MAX_DRAWING_POINTS }, () => ( { x: 30, y: 140 } ) ),
			'invalid',
		] ) {
			expect(
				parseInspectorSelection( { ...input, drawing: { ...input.drawing, originalStroke } } )
			).toBeNull();
		}
		expect( parseInspectorSelection( { ...input, replaces: 123 } ) ).toBeNull();
		expect( parseInspectorSelection( { ...selection, drawing: undefined } ) ).toBeNull();
	} );
} );
