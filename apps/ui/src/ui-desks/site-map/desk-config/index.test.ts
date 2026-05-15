import { describe, expect, it } from 'vitest';
import { createSiteMapDeskConfig, getSiteMapDeskConfigSignature } from './index';

describe( 'createSiteMapDeskConfig', () => {
	it( 'lays pages out as a parent-child tree of page widgets', () => {
		const desk = createSiteMapDeskConfig(
			[
				{ id: 3, parent: 1, menu_order: 2, title: { rendered: 'About' } },
				{ id: 1, parent: 0, menu_order: 1, title: { rendered: 'Home' } },
				{ id: 2, parent: 1, menu_order: 1, title: { rendered: 'Contact' } },
			],
			{ show_on_front: 'page', page_on_front: 1 }
		);

		const home = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-1' );
		const contact = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-2' );
		const about = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-3' );
		const pages = desk.widgets.filter( ( widget ) => widget.type === 'page' );
		const pageConnectors = desk.connectors?.filter(
			( connector ) => connector.to.widgetId !== 'site-map-post-collection'
		);

		expect( pages ).toHaveLength( 3 );
		expect( home ).toMatchObject( {
			type: 'page',
			y: 0,
			shapeProps: {
				w: 280,
				h: 380,
			},
			widgetProps: {
				pageId: 1,
				tone: 'sky',
			},
		} );
		expect( contact?.y ).toBeGreaterThan( home?.y ?? 0 );
		expect( about?.y ).toBe( contact?.y );
		expect( contact?.x ).toBeLessThan( about?.x ?? 0 );
		expect( contact?.type === 'page' ? contact.widgetProps.tone : undefined ).toBe( 'neutral' );
		expect( pageConnectors ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					from: expect.objectContaining( { widgetId: 'site-map-page-1' } ),
					to: expect.objectContaining( { widgetId: 'site-map-page-2' } ),
				} ),
				expect.objectContaining( {
					from: expect.objectContaining( { widgetId: 'site-map-page-1' } ),
					to: expect.objectContaining( { widgetId: 'site-map-page-3' } ),
				} ),
			] )
		);
	} );

	it( 'promotes pages with missing parents to roots', () => {
		const desk = createSiteMapDeskConfig(
			[
				{ id: 1, parent: 999, title: { rendered: 'Orphan' } },
				{ id: 2, parent: 1, title: { rendered: 'Child' } },
			],
			{ show_on_front: 'page' }
		);

		const orphan = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-1' );
		const child = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-2' );

		expect( orphan?.y ).toBe( 0 );
		expect( orphan?.type === 'page' ? orphan.widgetProps.tone : undefined ).toBe( 'sky' );
		expect( child?.y ).toBeGreaterThan( orphan?.y ?? 0 );
	} );

	it( 'uses the static front page as the parent for other root pages', () => {
		const desk = createSiteMapDeskConfig(
			[
				{ id: 1, parent: 0, title: { rendered: 'Home' } },
				{ id: 2, parent: 0, title: { rendered: 'About' } },
				{ id: 3, parent: 0, title: { rendered: 'Contact' } },
				{ id: 4, parent: 2, title: { rendered: 'Team' } },
			],
			{ show_on_front: 'page', page_on_front: 1 }
		);

		const home = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-1' );
		const about = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-2' );
		const contact = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-3' );
		const team = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-4' );

		expect( home?.y ).toBe( 0 );
		expect( about?.y ).toBeGreaterThan( home?.y ?? 0 );
		expect( contact?.y ).toBe( about?.y );
		expect( team?.y ).toBeGreaterThan( about?.y ?? 0 );
		expect( desk.connectors ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					from: expect.objectContaining( { widgetId: 'site-map-page-1' } ),
					to: expect.objectContaining( { widgetId: 'site-map-page-2' } ),
				} ),
				expect.objectContaining( {
					from: expect.objectContaining( { widgetId: 'site-map-page-1' } ),
					to: expect.objectContaining( { widgetId: 'site-map-page-3' } ),
				} ),
				expect.objectContaining( {
					from: expect.objectContaining( { widgetId: 'site-map-page-2' } ),
					to: expect.objectContaining( { widgetId: 'site-map-page-4' } ),
				} ),
			] )
		);
	} );

	it( 'returns an empty desk config when there are no pages', () => {
		expect( createSiteMapDeskConfig( [], null ) ).toEqual( {
			version: 1,
			updatedAt: '1970-01-01T00:00:00.000Z',
			widgets: [],
		} );
	} );

	it( 'adds recent posts as a post collection widget', () => {
		const desk = createSiteMapDeskConfig( [ { id: 1, parent: 0, title: { rendered: 'Home' } } ], {
			show_on_front: 'page',
		} );

		const postCollection = desk.widgets.find( ( widget ) => widget.type === 'post-collection' );

		expect( desk.widgets ).toHaveLength( 3 );
		expect( postCollection ).toMatchObject( {
			id: 'site-map-post-collection',
			shapeProps: {
				w: 280,
				h: 380,
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
		expect( postCollection?.x ).toBeGreaterThan(
			desk.widgets.find( ( widget ) => widget.id === 'site-map-page-1' )?.x ?? 0
		);
	} );

	it( 'adds a Blog widget as the posts collection parent for a posts homepage', () => {
		const desk = createSiteMapDeskConfig( [ { id: 1, parent: 0, title: { rendered: 'About' } } ], {
			show_on_front: 'posts',
		} );

		const blog = desk.widgets.find( ( widget ) => widget.id === 'site-map-blog' );
		const page = desk.widgets.find( ( widget ) => widget.id === 'site-map-page-1' );
		const postCollection = desk.widgets.find(
			( widget ) => widget.id === 'site-map-post-collection'
		);

		expect( blog ).toMatchObject( {
			type: 'blog',
			y: 0,
			widgetProps: {
				title: 'Blog',
			},
		} );
		expect( page?.y ).toBeGreaterThan( blog?.y ?? 0 );
		expect( postCollection?.y ).toBe( blog?.y );
		expect( desk.connectors ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					from: expect.objectContaining( { widgetId: 'site-map-blog' } ),
					to: expect.objectContaining( { widgetId: 'site-map-page-1' } ),
				} ),
				expect.objectContaining( {
					from: expect.objectContaining( { widgetId: 'site-map-blog' } ),
					to: expect.objectContaining( { widgetId: 'site-map-post-collection' } ),
				} ),
			] )
		);
	} );

	it( 'shows Blog and the posts collection even when a posts homepage has no pages', () => {
		const desk = createSiteMapDeskConfig( [], { show_on_front: 'posts' } );

		expect( desk.widgets.map( ( widget ) => widget.id ) ).toEqual( [
			'site-map-blog',
			'site-map-post-collection',
		] );
		expect( desk.connectors ).toHaveLength( 1 );
		expect( desk.connectors?.[ 0 ] ).toMatchObject( {
			from: { widgetId: 'site-map-blog' },
			to: { widgetId: 'site-map-post-collection' },
		} );
	} );

	it( 'includes hierarchy fields in the signature', () => {
		const first = getSiteMapDeskConfigSignature(
			[
				{ id: 1, parent: 0, title: { rendered: 'Home' } },
				{ id: 2, parent: 1, title: { rendered: 'About' } },
			],
			{ show_on_front: 'page' }
		);
		const second = getSiteMapDeskConfigSignature(
			[
				{ id: 1, parent: 0, title: { rendered: 'Home' } },
				{ id: 2, parent: 0, title: { rendered: 'About' } },
			],
			{ show_on_front: 'page' }
		);

		expect( first ).not.toBe( second );
	} );

	it( 'includes front page settings in the signature', () => {
		const pages = [ { id: 1, parent: 0, title: { rendered: 'Home' } } ];

		expect( getSiteMapDeskConfigSignature( pages, { show_on_front: 'page' } ) ).not.toBe(
			getSiteMapDeskConfigSignature( pages, { show_on_front: 'posts' } )
		);
	} );
} );
