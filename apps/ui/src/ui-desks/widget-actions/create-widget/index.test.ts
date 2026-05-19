import { describe, expect, it, vi } from 'vitest';
import { createDeskWidget } from './index';

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

	it( 'creates a bookmark widget with supplied URL props', () => {
		const createdWidget = createDeskWidget( {
			id: 'bookmark-1',
			type: 'bookmark',
			center: {
				x: 500,
				y: 400,
			},
			zIndex: 'a1',
			widgetProps: {
				url: 'https://example.com/',
			},
		} );

		expect( createdWidget ).toEqual( {
			id: 'bookmark-1',
			type: 'bookmark',
			x: 350,
			y: 349.5,
			zIndex: 'a1',
			shapeProps: {
				w: 300,
				h: 101,
			},
			widgetProps: {
				url: 'https://example.com/',
			},
		} );
	} );

	it( 'creates an embed widget with supplied URL props', () => {
		const createdWidget = createDeskWidget( {
			id: 'embed-1',
			type: 'embed',
			center: {
				x: 500,
				y: 400,
			},
			zIndex: 'a7',
			shapeProps: {
				w: 800,
				h: 450,
			},
			widgetProps: {
				url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			},
		} );

		expect( createdWidget ).toEqual( {
			id: 'embed-1',
			type: 'embed',
			x: 100,
			y: 175,
			zIndex: 'a7',
			shapeProps: {
				w: 800,
				h: 450,
			},
			widgetProps: {
				url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			},
		} );
	} );

	it( 'creates a scratchpad widget with supplied HTML props', () => {
		const createdWidget = createDeskWidget( {
			id: 'scratchpad-1',
			type: 'scratchpad',
			center: {
				x: 700,
				y: 500,
			},
			zIndex: 'a8',
			shapeProps: {
				w: 568,
				h: 524,
			},
			widgetProps: {
				html: '<!doctype html><html><body><h1>Example</h1></body></html>',
				title: 'Example scratchpad',
				scope: 'block',
				description: 'Render this HTML.',
			},
		} );

		expect( createdWidget ).toEqual( {
			id: 'scratchpad-1',
			type: 'scratchpad',
			x: 416,
			y: 238,
			zIndex: 'a8',
			shapeProps: {
				w: 568,
				h: 524,
			},
			widgetProps: {
				html: '<!doctype html><html><body><h1>Example</h1></body></html>',
				title: 'Example scratchpad',
				scope: 'block',
				description: 'Render this HTML.',
			},
		} );
	} );

	it( 'creates an empty scratchpad widget at the reference workbench size', () => {
		const createdWidget = createDeskWidget( {
			id: 'scratchpad-1',
			type: 'scratchpad',
			center: {
				x: 700,
				y: 500,
			},
			zIndex: 'a8',
		} );

		expect( createdWidget ).toEqual( {
			id: 'scratchpad-1',
			type: 'scratchpad',
			x: 460,
			y: 320,
			zIndex: 'a8',
			shapeProps: {
				w: 480,
				h: 360,
			},
			widgetProps: {
				html: '',
				title: '',
				scope: 'block',
				description: '',
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

	it( 'creates a site card widget with optional site identity props', () => {
		const createdWidget = createDeskWidget( {
			id: 'site-card-1',
			type: 'site-card',
			center: {
				x: 500,
				y: 400,
			},
			zIndex: 'a9',
			widgetProps: {
				siteId: 'site-123',
			},
		} );

		expect( createdWidget ).toEqual( {
			id: 'site-card-1',
			type: 'site-card',
			x: 320,
			y: 300,
			zIndex: 'a9',
			shapeProps: {
				w: 360,
				h: 200,
			},
			widgetProps: {
				previewVisible: false,
				siteId: 'site-123',
			},
		} );
	} );

	it( 'creates a drawing widget with supplied SVG props', () => {
		const createdWidget = createDeskWidget( {
			id: 'drawing-1',
			type: 'drawing',
			center: {
				x: 400,
				y: 300,
			},
			zIndex: 'a6',
			shapeProps: {
				w: 240,
				h: 180,
			},
			widgetProps: {
				svg: '<svg viewBox="0 0 240 180" />',
			},
		} );

		expect( createdWidget ).toEqual( {
			id: 'drawing-1',
			type: 'drawing',
			x: 280,
			y: 210,
			zIndex: 'a6',
			shapeProps: {
				w: 240,
				h: 180,
			},
			widgetProps: {
				svg: '<svg viewBox="0 0 240 180" />',
			},
		} );
	} );

	it( 'creates a media widget with supplied media props', () => {
		const createdWidget = createDeskWidget( {
			id: 'media-1',
			type: 'media',
			center: {
				x: 500,
				y: 400,
			},
			zIndex: 'a6',
			widgetProps: {
				url: 'https://example.com/image.jpg',
				mediaKind: 'image',
				alt: 'Example image',
				mediaId: 123,
			},
		} );

		expect( createdWidget ).toEqual( {
			id: 'media-1',
			type: 'media',
			x: 340,
			y: 240,
			zIndex: 'a6',
			shapeProps: {
				w: 320,
				h: 320,
			},
			widgetProps: {
				url: 'https://example.com/image.jpg',
				mediaKind: 'image',
				alt: 'Example image',
				mediaId: 123,
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
