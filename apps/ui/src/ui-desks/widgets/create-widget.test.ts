import { describe, expect, it, vi } from 'vitest';
import { createDeskWidget } from './create-widget';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
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

	it( 'creates a page widget with supplied page props', () => {
		const createdWidget = createDeskWidget( {
			id: 'page-1',
			type: 'page',
			center: {
				x: 500,
				y: 400,
			},
			zIndex: 'a4',
			widgetProps: {
				pageId: 84,
				tone: 'blue',
			},
		} );

		expect( createdWidget ).toEqual( {
			id: 'page-1',
			type: 'page',
			x: 360,
			y: 210,
			zIndex: 'a4',
			shapeProps: {
				w: 280,
				h: 380,
			},
			widgetProps: {
				pageId: 84,
				tone: 'blue',
			},
		} );
	} );

	it( 'creates a site preview widget centered on the requested point', () => {
		const createdWidget = createDeskWidget( {
			id: 'site-preview-1',
			type: 'site-preview',
			center: {
				x: 500,
				y: 400,
			},
			zIndex: 'a5',
		} );

		expect( createdWidget ).toEqual( {
			id: 'site-preview-1',
			type: 'site-preview',
			x: 220,
			y: 190,
			zIndex: 'a5',
			shapeProps: {
				w: 560,
				h: 420,
			},
			widgetProps: {
				path: '/',
			},
		} );
	} );

	it( 'creates a post collection widget with default query props', () => {
		const createdWidget = createDeskWidget( {
			id: 'post-collection-1',
			type: 'post-collection',
			center: {
				x: 500,
				y: 400,
			},
			zIndex: 'a5',
		} );

		expect( createdWidget ).toEqual( {
			id: 'post-collection-1',
			type: 'post-collection',
			x: 499.5,
			y: 399.5,
			zIndex: 'a5',
			shapeProps: {
				w: 1,
				h: 1,
			},
			widgetProps: {
				query: {
					postType: 'post',
					perPage: 5,
					status: 'publish',
					orderby: 'date',
					order: 'desc',
				},
			},
		} );
	} );
} );
