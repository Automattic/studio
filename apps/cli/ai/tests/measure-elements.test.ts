import { describe, expect, it } from 'vitest';
import { formatMeasureResult, type MeasuredElement } from '../tools/measure-elements';

const element: MeasuredElement = {
	tagName: 'div',
	className: 'wp-block-group features-grid is-layout-grid',
	rect: { x: 40, y: 1200, width: 960, height: 320 },
	styles: {
		display: 'grid',
		gridTemplateColumns: '320px 320px 320px',
		flexWrap: 'nowrap',
		width: '960px',
	},
};

describe( 'formatMeasureResult', () => {
	it( 'reports a no-match result with selector guidance', () => {
		const text = formatMeasureResult( 'http://localhost:8897', '.missing', 0, [] );
		expect( text ).toContain( 'No elements matched ".missing"' );
		expect( text ).toContain( 'is-layout-grid' );
	} );

	it( 'renders the box and layout styles for a match', () => {
		const text = formatMeasureResult( 'http://localhost:8897', '.features-grid', 1, [ element ] );
		expect( text ).toContain( '1 element(s) matched ".features-grid"' );
		expect( text ).toContain( '<div .wp-block-group.features-grid.is-layout-grid>' );
		expect( text ).toContain( 'rect: 960×320 at (40, 1200)' );
		expect( text ).toContain( 'gridTemplateColumns: 320px 320px 320px' );
	} );

	it( 'notes truncation when more elements matched than are shown', () => {
		const text = formatMeasureResult( 'http://localhost:8897', '.card', 6, [ element ] );
		expect( text ).toContain( '6 elements matched ".card"' );
		expect( text ).toContain( 'showing the first 1' );
	} );
} );
