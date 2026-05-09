import { describe, expect, it, vi } from 'vitest';
import { createDeskWidget } from './create-widget';

vi.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

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

	it( 'creates a post widget with supplied post props', () => {
		const createdWidget = createDeskWidget( {
			id: 'post-1',
			type: 'post',
			center: {
				x: 500,
				y: 400,
			},
			zIndex: 'a3',
			widgetProps: {
				postId: 42,
			},
		} );

		expect( createdWidget ).toEqual( {
			id: 'post-1',
			type: 'post',
			x: 360,
			y: 210,
			zIndex: 'a3',
			shapeProps: {
				w: 280,
				h: 380,
			},
			widgetProps: {
				postId: 42,
			},
		} );
	} );
} );
