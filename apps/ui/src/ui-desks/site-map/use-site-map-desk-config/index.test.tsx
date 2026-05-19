import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOG_WIDGET_TYPE } from '@/ui-desks/widgets/blog/types';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { POST_COLLECTION_WIDGET_TYPE } from '@/ui-desks/widgets/post-collection/types';
import { useSiteMapDeskConfig } from './index';
import type { SiteMapPage, SiteMapSettings } from '../desk-config';

type SiteFixture = {
	id: string;
	running: boolean;
};

type CoreDataResolutionStatus = 'IDLE' | 'RESOLVING' | 'SUCCESS' | 'ERROR';
type CoreDataResolutionStateStatus = 'resolving' | 'finished' | 'error' | undefined;

const mockState = vi.hoisted( () => ( {
	sites: [] as SiteFixture[] | undefined,
	isLoadingSites: false,
	pages: [] as SiteMapPage[] | null,
	isResolvingPages: false,
	pagesStatus: 'SUCCESS' as CoreDataResolutionStatus,
	rootIndexSettings: undefined as SiteMapSettings | undefined,
	rootIndexResolutionStatus: 'finished' as CoreDataResolutionStateStatus,
	entityRecordsArgs: undefined as unknown[] | undefined,
	entityRecordsOptions: undefined as unknown,
	entityRecordArgs: undefined as unknown[] | undefined,
	resolutionStateArgs: undefined as unknown[] | undefined,
} ) );

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecords: ( ...args: unknown[] ) => {
		mockState.entityRecordsArgs = args;
		mockState.entityRecordsOptions = args[ 3 ];

		return {
			records: mockState.pages,
			isResolving: mockState.isResolvingPages,
			status: mockState.pagesStatus,
		};
	},
} ) );

vi.mock( '@wordpress/data', () => ( {
	useSelect: ( mapSelect: ( select: ( store: unknown ) => unknown ) => unknown ) =>
		mapSelect( () => ( {
			getEntityRecord: ( ...args: unknown[] ) => {
				mockState.entityRecordArgs = args;
				return mockState.rootIndexSettings;
			},
			getResolutionState: ( ...args: unknown[] ) => {
				mockState.resolutionStateArgs = args;

				return mockState.rootIndexResolutionStatus
					? { status: mockState.rootIndexResolutionStatus }
					: undefined;
			},
		} ) ),
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text: string ) => text,
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( {
		data: mockState.sites,
		isLoading: mockState.isLoadingSites,
	} ),
} ) );

describe( 'useSiteMapDeskConfig', () => {
	beforeEach( () => {
		mockState.sites = [ { id: 'site-1', running: true } ];
		mockState.isLoadingSites = false;
		mockState.pages = [];
		mockState.isResolvingPages = false;
		mockState.pagesStatus = 'SUCCESS';
		mockState.rootIndexSettings = undefined;
		mockState.rootIndexResolutionStatus = 'finished';
		mockState.entityRecordsArgs = undefined;
		mockState.entityRecordsOptions = undefined;
		mockState.entityRecordArgs = undefined;
		mockState.resolutionStateArgs = undefined;
	} );

	it( 'loads front page settings from the root index core-data entity', () => {
		mockState.rootIndexSettings = { show_on_front: 'page', page_on_front: 1 };
		mockState.pages = [
			{ id: 1, parent: 0, menu_order: 0, title: { rendered: 'Home' }, slug: 'home' },
			{ id: 2, parent: 0, menu_order: 1, title: { rendered: 'About' }, slug: 'about' },
		];

		const { result } = renderHook( () => useSiteMapDeskConfig( 'site-1', true ) );

		expect( mockState.entityRecordsArgs?.slice( 0, 3 ) ).toEqual( [
			'postType',
			'page',
			expect.objectContaining( {
				per_page: 100,
				orderby: 'menu_order',
				_fields: 'id,parent,menu_order,title,slug,status',
			} ),
		] );
		expect( mockState.entityRecordsOptions ).toEqual( { enabled: true } );
		expect( mockState.entityRecordArgs ).toEqual( [ 'root', '__unstableBase' ] );
		expect( mockState.resolutionStateArgs ).toEqual( [
			'getEntityRecord',
			[ 'root', '__unstableBase' ],
		] );
		expect( result.current.message ).toBeUndefined();
		expect( result.current.isLoading ).toBe( false );
		expect( result.current.pageCount ).toBe( 3 );
		expect( result.current.config.connectors ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					from: expect.objectContaining( { widgetId: 'site-map-page-1' } ),
					to: expect.objectContaining( { widgetId: 'site-map-page-2' } ),
				} ),
			] )
		);
	} );

	it( 'builds a Blog widget from latest-posts front page settings without page records', () => {
		mockState.rootIndexSettings = { show_on_front: 'posts' };
		mockState.pages = [];

		const { result } = renderHook( () => useSiteMapDeskConfig( 'site-1', true ) );

		expect( result.current.message ).toBeUndefined();
		expect( result.current.pageCount ).toBe( 1 );
		expect( result.current.config.widgets.map( ( widget ) => widget.type ) ).toEqual( [
			BLOG_WIDGET_TYPE,
			POST_COLLECTION_WIDGET_TYPE,
		] );
		expect( result.current.config.connectors ).toEqual( [
			expect.objectContaining( {
				from: expect.objectContaining( { widgetId: 'site-map-blog' } ),
				to: expect.objectContaining( { widgetId: 'site-map-post-collection' } ),
			} ),
		] );
	} );

	it( 'keeps core-data queries disabled until the selected site is running', () => {
		mockState.sites = [ { id: 'site-1', running: false } ];
		mockState.rootIndexResolutionStatus = undefined;
		mockState.pages = null;

		const { result } = renderHook( () => useSiteMapDeskConfig( 'site-1', true ) );

		expect( mockState.entityRecordsOptions ).toEqual( { enabled: false } );
		expect( mockState.entityRecordArgs ).toBeUndefined();
		expect( mockState.resolutionStateArgs ).toBeUndefined();
		expect( result.current.config.widgets ).toEqual( [] );
		expect( result.current.message ).toBe( 'Start the site to view its site map.' );
	} );

	it( 'reports loading while the root index settings request is resolving', () => {
		mockState.pages = [
			{ id: 1, parent: 0, menu_order: 0, title: { rendered: 'Home' }, slug: 'home' },
		];
		mockState.rootIndexSettings = undefined;
		mockState.rootIndexResolutionStatus = 'resolving';

		const { result } = renderHook( () => useSiteMapDeskConfig( 'site-1', true ) );

		expect( result.current.isLoading ).toBe( true );
		expect( result.current.message ).toBeUndefined();
		expect( result.current.pageCount ).toBe( 1 );
		expect(
			result.current.config.widgets.some( ( widget ) => widget.type === PAGE_WIDGET_TYPE )
		).toBe( true );
	} );
} );
