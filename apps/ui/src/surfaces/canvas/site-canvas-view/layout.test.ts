import { describe, expect, it } from 'vitest';
import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';
import { BLOG_WIDGET_TYPE, type BlogWidget } from '@/ui-desks/widgets/blog/types';
import { PAGE_WIDGET_TYPE, type PageWidget } from '@/ui-desks/widgets/page/types';
import {
	POST_COLLECTION_WIDGET_TYPE,
	type PostCollectionWidget,
} from '@/ui-desks/widgets/post-collection/types';
import { THEME_WIDGET_TYPE } from '@/ui-desks/widgets/theme/types';
import {
	THEME_CANVAS_THEME_WIDGET_ID,
	createSiteMapCanvasDeskConfig,
	createThemeCanvasDeskConfig,
	getSiteCanvasDeskConfigSignature,
} from './layout';

const pageWidget: PageWidget = {
	id: 'site-map-page-1',
	type: PAGE_WIDGET_TYPE,
	x: 100,
	y: 120,
	zIndex: 'a1',
	shapeProps: { w: 280, h: 380 },
	widgetProps: { pageId: 1, tone: 'blue' },
};

const blogWidget: BlogWidget = {
	id: 'site-map-blog',
	type: BLOG_WIDGET_TYPE,
	x: 476,
	y: 120,
	zIndex: 'a2',
	shapeProps: { w: 280, h: 380 },
	widgetProps: { title: 'Blog', slug: 'blog' },
};

const postCollectionWidget: PostCollectionWidget = {
	id: 'site-map-post-collection',
	type: POST_COLLECTION_WIDGET_TYPE,
	x: 852,
	y: 120,
	zIndex: 'a3',
	shapeProps: { w: 280, h: 380 },
	widgetProps: {
		query: {
			postType: 'post',
			perPage: 5,
			status: 'publish',
			orderby: 'date',
			order: 'desc',
		},
	},
};

const siteMapConfig: DeskConfig = {
	version: DESK_CONFIG_VERSION,
	updatedAt: '1970-01-01T00:00:00.000Z',
	widgets: [ pageWidget, blogWidget, postCollectionWidget ],
	connectors: [
		{
			id: 'site-map-blog-to-posts',
			from: {
				widgetId: 'site-map-blog',
				normalizedAnchor: { x: 1, y: 0.5 },
			},
			to: {
				widgetId: 'site-map-post-collection',
				normalizedAnchor: { x: 0, y: 0.5 },
			},
		},
	],
};

describe( 'site canvas desk config', () => {
	it( 'keeps the site map canvas focused on sitemap widgets', () => {
		const config = createSiteMapCanvasDeskConfig( siteMapConfig );

		expect( config.widgets.map( ( widget ) => widget.type ) ).toEqual( [
			PAGE_WIDGET_TYPE,
			BLOG_WIDGET_TYPE,
			POST_COLLECTION_WIDGET_TYPE,
		] );
		expect( config.connectors ).toEqual( siteMapConfig.connectors );
		expect( config.widgets.some( ( widget ) => widget.type === THEME_WIDGET_TYPE ) ).toBe( false );
	} );

	it( 'creates a theme canvas from the active theme widget', () => {
		const config = createThemeCanvasDeskConfig();

		expect( config.widgets ).toEqual( [
			expect.objectContaining( {
				id: THEME_CANVAS_THEME_WIDGET_ID,
				type: THEME_WIDGET_TYPE,
				x: 120,
				y: 120,
				widgetProps: { viewMode: 'tiles' },
			} ),
		] );
	} );

	it( 'preserves saved theme widget position and viewport per site', () => {
		const savedConfig: DeskConfig = {
			version: DESK_CONFIG_VERSION,
			updatedAt: '2026-06-01T12:00:00.000Z',
			viewport: { x: 10, y: 20, z: 0.75 },
			widgets: [
				{
					id: THEME_CANVAS_THEME_WIDGET_ID,
					type: THEME_WIDGET_TYPE,
					x: 1200,
					y: 320,
					zIndex: 'b2',
					shapeProps: { w: 760, h: 440 },
					widgetProps: { viewMode: 'tiles' },
				},
			],
		};

		const config = createThemeCanvasDeskConfig( savedConfig );

		expect( config.viewport ).toEqual( { x: 10, y: 20, z: 0.75 } );
		expect(
			config.widgets.find( ( widget ) => widget.id === THEME_CANVAS_THEME_WIDGET_ID )
		).toMatchObject( {
			type: THEME_WIDGET_TYPE,
			x: 1200,
			y: 320,
			zIndex: 'b2',
		} );
	} );

	it( 'preserves saved site map widget positions and viewport per site', () => {
		const savedConfig: DeskConfig = {
			version: DESK_CONFIG_VERSION,
			updatedAt: '2026-06-01T12:00:00.000Z',
			viewport: { x: 10, y: 20, z: 0.75 },
			widgets: [
				{
					...siteMapConfig.widgets[ 0 ],
					x: 444,
					y: 222,
					zIndex: 'b1',
				},
			],
		};

		const config = createSiteMapCanvasDeskConfig( siteMapConfig, savedConfig );

		expect( config.viewport ).toEqual( { x: 10, y: 20, z: 0.75 } );
		expect( config.widgets.find( ( widget ) => widget.id === 'site-map-page-1' ) ).toMatchObject( {
			x: 444,
			y: 222,
			zIndex: 'b1',
		} );
	} );

	it( 'signs content separately from saved position changes', () => {
		const config = createSiteMapCanvasDeskConfig( siteMapConfig );

		expect( getSiteCanvasDeskConfigSignature( 'pages-v1', config ) ).toContain( 'pages-v1' );
		expect( getSiteCanvasDeskConfigSignature( 'pages-v1', config ) ).not.toBe(
			getSiteCanvasDeskConfigSignature( 'pages-v2', config )
		);
	} );
} );
