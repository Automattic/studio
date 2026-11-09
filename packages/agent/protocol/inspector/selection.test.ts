import { describe, expect, it } from 'vitest';
import { parseInspectorSelection, type InspectorSelection } from './selection';

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
	it( 'accepts a rectangle without an element selector and preserves scrolled geometry', () => {
		expect( parseInspectorSelection( selection ) ).toMatchObject( selection );
	} );
	it.each( [
		{ rect: { left: -1, top: 20, width: 300, height: 200 } },
		{ rect: { left: 10, top: 20, width: 1000, height: 200 } },
		{ rect: { left: 10, top: 20, width: NaN, height: 200 } },
		{ rect: { left: 10.5, top: 20, width: 300, height: 200 } },
		{ scroll: { left: 0, top: 400 } },
		{ target: { ...selection.target, kind: 'drawing' } },
	] )( 'rejects invalid or inconsistent capture geometry: %j', ( patch ) => {
		expect( parseInspectorSelection( { ...selection, ...patch } ) ).toBeNull();
	} );
} );
