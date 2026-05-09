import { describe, expect, it } from 'vitest';
import { createDeskWidget } from './create-widget';

describe( 'createDeskWidget', () => {
	it( 'creates a note widget centered on the requested point', () => {
		const createdWidget = createDeskWidget( {
			id: 'note-1',
			type: 'note',
			center: {
				x: 400,
				y: 300,
			},
			zIndex: 'a2',
		} );

		expect( createdWidget ).toEqual( {
			id: 'note-1',
			type: 'note',
			x: 300,
			y: 200,
			zIndex: 'a2',
			shapeProps: {
				w: 200,
				h: 200,
			},
			widgetProps: {
				text: '',
				tone: 'yellow',
			},
		} );
	} );

	it( 'ignores unsupported widget types', () => {
		expect(
			createDeskWidget( {
				id: 'unsupported',
				type: 'unsupported',
				center: {
					x: 0,
					y: 0,
				},
				zIndex: 'a1',
			} )
		).toBeNull();
	} );
} );
