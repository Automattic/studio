import { describe, expect, it, vi } from 'vitest';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { POST_WIDGET_TYPE } from '@/ui-desks/widgets/post/types';
import { POST_COLLECTION_WIDGET_TYPE } from '@/ui-desks/widgets/post-collection/types';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import { getSelectedWidgetToolbarItem } from './toolbar-selection';
import type { DeskWidget } from '@/ui-desks/widgets/types';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

describe( 'widget toolbar selection', () => {
	it( 'returns the toolbar item for a single note widget selection', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createNoteWidget() ] );

		expect( selectedItem ).toMatchObject( { kind: 'single-widget' } );
		if ( selectedItem?.kind !== 'single-widget' ) {
			throw new Error( 'Expected a single widget toolbar item.' );
		}
		expect( selectedItem.definition.type ).toBe( NOTE_WIDGET_TYPE );
		expect( selectedItem.canRemove ).toBe( true );
		expect( selectedItem.widget.widgetProps ).toEqual( {
			text: 'Hello',
			tone: 'yellow',
		} );
	} );

	it( 'returns the toolbar item for a single post widget selection', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createPostWidget() ] );

		expect( selectedItem ).toMatchObject( { kind: 'single-widget' } );
		if ( selectedItem?.kind !== 'single-widget' ) {
			throw new Error( 'Expected a single widget toolbar item.' );
		}
		expect( selectedItem.definition.type ).toBe( POST_WIDGET_TYPE );
		expect( selectedItem.definition.controls?.[ 0 ]?.type ).toBe( 'custom' );
		expect( selectedItem.widget.widgetProps ).toEqual( {
			postId: 42,
		} );
	} );

	it( 'returns the toolbar item for a single page widget selection', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createPageWidget() ] );

		expect( selectedItem ).toMatchObject( { kind: 'single-widget' } );
		if ( selectedItem?.kind !== 'single-widget' ) {
			throw new Error( 'Expected a single widget toolbar item.' );
		}
		expect( selectedItem.definition.type ).toBe( PAGE_WIDGET_TYPE );
		expect( selectedItem.definition.controls?.[ 0 ]?.type ).toBe( 'color' );
		expect( selectedItem.widget.widgetProps ).toEqual( {
			pageId: 84,
			tone: 'blue',
		} );
	} );

	it( 'returns the toolbar item for a single site preview widget selection', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createSitePreviewWidget() ] );
		expect( selectedItem ).toMatchObject( { kind: 'single-widget' } );
		if ( selectedItem?.kind !== 'single-widget' ) {
			throw new Error( 'Expected a single widget toolbar item.' );
		}
		expect( selectedItem.definition.type ).toBe( SITE_PREVIEW_WIDGET_TYPE );
		expect( selectedItem.definition.controls?.[ 0 ]?.type ).toBe( 'custom' );
		expect( selectedItem.widget.widgetProps ).toEqual( {
			path: '/',
		} );
	} );

	it( 'returns the toolbar item for a single post collection widget selection', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createPostCollectionWidget() ] );

		expect( selectedItem ).toMatchObject( { kind: 'single-widget' } );
		if ( selectedItem?.kind !== 'single-widget' ) {
			throw new Error( 'Expected a single widget toolbar item.' );
		}
		expect( selectedItem.definition.type ).toBe( POST_COLLECTION_WIDGET_TYPE );
		expect( selectedItem.definition.controls?.[ 0 ]?.type ).toBe( 'custom' );
		expect( selectedItem.widget.widgetProps ).toEqual( {
			query: {
				postType: 'post',
				perPage: 5,
				status: 'publish',
				orderby: 'date',
				order: 'desc',
			},
		} );
	} );

	it( 'can disable removal for protected selections', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createPostCollectionWidget() ], {
			canRemove: false,
		} );

		expect( selectedItem ).toMatchObject( {
			kind: 'single-widget',
			canRemove: false,
		} );
	} );

	it( 'ignores empty selections and returns stack actions for multi-widget selections', () => {
		const widget = createNoteWidget();

		expect( getSelectedWidgetToolbarItem( [] ) ).toBeNull();
		expect( getSelectedWidgetToolbarItem( [ widget, widget ] ) ).toMatchObject( {
			kind: 'multi-widget',
			canStack: true,
			canUnstack: false,
		} );
	} );

	it( 'returns unstack actions for selections with stack members', () => {
		const widget = createNoteWidget();

		expect(
			getSelectedWidgetToolbarItem( [ widget, widget ], { stackIds: [ 'stack-1' ] } )
		).toMatchObject( {
			kind: 'multi-widget',
			canStack: false,
			canUnstack: true,
			stackIds: [ 'stack-1' ],
		} );
	} );

	it( 'ignores unsupported widgets', () => {
		const widget = {
			...createNoteWidget(),
			type: 'unsupported',
		} as unknown as DeskWidget;

		expect( getSelectedWidgetToolbarItem( [ widget ] ) ).toBeNull();
	} );

	it( 'ignores widgets with invalid props', () => {
		const widget = {
			...createNoteWidget(),
			widgetProps: {
				text: 'Hello',
				tone: 'purple',
			},
		} as unknown as DeskWidget;

		expect( getSelectedWidgetToolbarItem( [ widget ] ) ).toBeNull();
	} );
} );

function createNoteWidget(): DeskWidget {
	return {
		id: 'note-1',
		type: NOTE_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 200,
			h: 200,
		},
		widgetProps: {
			text: 'Hello',
			tone: 'yellow',
		},
	};
}

function createPostWidget(): DeskWidget {
	return {
		id: 'post-1',
		type: POST_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 280,
			h: 380,
		},
		widgetProps: {
			postId: 42,
		},
	};
}

function createPageWidget(): DeskWidget {
	return {
		id: 'page-1',
		type: PAGE_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 280,
			h: 380,
		},
		widgetProps: {
			pageId: 84,
			tone: 'blue',
		},
	};
}

function createSitePreviewWidget(): DeskWidget {
	return {
		id: 'site-preview-1',
		type: SITE_PREVIEW_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 480,
			h: 360,
		},
		widgetProps: {
			path: '/',
		},
	};
}

function createPostCollectionWidget(): DeskWidget {
	return {
		id: 'collection-1',
		type: POST_COLLECTION_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
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
	};
}
