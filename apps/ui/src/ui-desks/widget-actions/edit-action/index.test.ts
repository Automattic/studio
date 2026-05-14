import { describe, expect, it, vi } from 'vitest';
import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { postCollectionWidgetDefinition } from '@/ui-desks/widgets/post-collection/definition';
import { scratchpadWidgetDefinition } from '@/ui-desks/widgets/scratchpad/definition';
import { siteCardWidgetDefinition } from '@/ui-desks/widgets/site-card/definition';
import { sitePreviewWidgetDefinition } from '@/ui-desks/widgets/site-preview/definition';
import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { PageWidget } from '@/ui-desks/widgets/page/types';
import type { PostWidget } from '@/ui-desks/widgets/post/types';
import type { PostCollectionWidget } from '@/ui-desks/widgets/post-collection/types';
import type { ScratchpadWidget } from '@/ui-desks/widgets/scratchpad/types';
import type { SiteCardWidget } from '@/ui-desks/widgets/site-card/types';
import type { SitePreviewWidget } from '@/ui-desks/widgets/site-preview/types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';
import type { DeskWidgetBase } from '@studio/common/types/desk';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );
vi.mock( '@/ui-desks/widgets/site-preview/open-control', () => ( {
	SitePreviewOpenControl: () => null,
} ) );
vi.mock( '@/ui-desks/widgets/site-preview/component', () => ( {
	SitePreviewWidgetComponent: () => null,
	SitePreviewWidgetThumbnailComponent: () => null,
} ) );
vi.mock( '@/ui-desks/widgets/site-card/component', () => ( {
	SiteCardWidgetComponent: () => null,
	SiteCardWidgetThumbnailComponent: () => null,
} ) );
vi.mock( '@/ui-desks/widgets/site-card/preview-control', () => ( {
	SiteCardPreviewControl: () => null,
} ) );
vi.mock( '@/ui-desks/widgets/site-card/edit-controls', () => ( {
	SiteCardEditCancelControl: () => null,
	SiteCardEditSaveControl: () => null,
} ) );

describe( 'widget edit actions', () => {
	it( 'uses canvas editing for interactive canvas widgets', () => {
		expect(
			getEditAction( noteWidgetDefinition )( {
				widget: createNoteWidget(),
				hasSiteId: false,
				hasRunningSite: false,
			} )
		).toEqual( { kind: 'canvas-editing' } );
		expect(
			getEditAction( sitePreviewWidgetDefinition )( {
				widget: createSitePreviewWidget(),
				hasSiteId: false,
				hasRunningSite: false,
			} )
		).toEqual( { kind: 'canvas-editing' } );
		expect(
			getEditAction( scratchpadWidgetDefinition )( {
				widget: createScratchpadWidget(),
				hasSiteId: false,
				hasRunningSite: false,
			} )
		).toEqual( { kind: 'canvas-editing' } );
	} );

	it( 'uses focus mode for site identity card editing', () => {
		expect(
			getEditAction( siteCardWidgetDefinition )( {
				widget: createSiteCardWidget(),
				hasSiteId: false,
				hasRunningSite: false,
			} )
		).toEqual( { kind: 'focus-mode' } );
	} );

	it( 'uses WordPress admin URLs for site-backed widgets', () => {
		expect(
			postWidgetDefinition.getEditAction?.( {
				widget: createPostWidget( 42 ),
				hasSiteId: true,
				hasRunningSite: true,
			} )
		).toEqual( { kind: 'site-url', path: '/wp-admin/post.php?post=42&action=edit' } );
		expect(
			pageWidgetDefinition.getEditAction?.( {
				widget: createPageWidget( 84 ),
				hasSiteId: true,
				hasRunningSite: true,
			} )
		).toEqual( { kind: 'site-url', path: '/wp-admin/post.php?post=84&action=edit' } );
		expect(
			postCollectionWidgetDefinition.getEditAction?.( {
				widget: createPostCollectionWidget(),
				hasSiteId: true,
				hasRunningSite: true,
			} )
		).toEqual( { kind: 'site-url', path: '/wp-admin/edit.php' } );
	} );

	it( 'does not expose WordPress admin edit actions without a running site', () => {
		expect(
			postWidgetDefinition.getEditAction?.( {
				widget: createPostWidget( 42 ),
				hasSiteId: true,
				hasRunningSite: false,
			} )
		).toBeNull();
		expect(
			pageWidgetDefinition.getEditAction?.( {
				widget: createPageWidget( 84 ),
				hasSiteId: false,
				hasRunningSite: true,
			} )
		).toBeNull();
		expect(
			postCollectionWidgetDefinition.getEditAction?.( {
				widget: createPostCollectionWidget(),
				hasSiteId: true,
				hasRunningSite: false,
			} )
		).toBeNull();
	} );

	it( 'does not expose WordPress admin edit actions for placeholder content', () => {
		expect(
			postWidgetDefinition.getEditAction?.( {
				widget: createPostWidget( 0 ),
				hasSiteId: true,
				hasRunningSite: true,
			} )
		).toBeNull();
		expect(
			pageWidgetDefinition.getEditAction?.( {
				widget: createPageWidget( 0 ),
				hasSiteId: true,
				hasRunningSite: true,
			} )
		).toBeNull();
	} );
} );

function createNoteWidget(): NoteWidget {
	return {
		...createWidgetBase( 'note' ),
		widgetProps: {
			text: 'Hello',
			tone: 'yellow',
		},
	};
}

function createSitePreviewWidget(): SitePreviewWidget {
	return {
		...createWidgetBase( 'site-preview' ),
		widgetProps: {
			path: '/',
		},
	};
}

function createSiteCardWidget(): SiteCardWidget {
	return {
		...createWidgetBase( 'site-card' ),
		widgetProps: {
			previewVisible: false,
		},
	};
}

function createScratchpadWidget(): ScratchpadWidget {
	return {
		...createWidgetBase( 'scratchpad' ),
		widgetProps: {
			html: '<!doctype html><html><body>Example</body></html>',
			title: 'Example',
			scope: 'block',
			description: 'Example description',
		},
	};
}

function createPostWidget( postId: number ): PostWidget {
	return {
		...createWidgetBase( 'post' ),
		widgetProps: {
			postId,
		},
	};
}

function createPageWidget( pageId: number ): PageWidget {
	return {
		...createWidgetBase( 'page' ),
		widgetProps: {
			pageId,
			tone: 'neutral',
		},
	};
}

function createPostCollectionWidget(): PostCollectionWidget {
	return {
		...createWidgetBase( 'post-collection' ),
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

function createWidgetBase< TType extends string >( type: TType ) {
	return {
		id: `${ type }-1`,
		type,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 320,
			h: 240,
		},
	};
}

function getEditAction< TWidget extends DeskWidgetBase >( definition: {
	type: string;
	getEditAction?: WidgetDefinition< TWidget >[ 'getEditAction' ];
} ) {
	if ( ! definition.getEditAction ) {
		throw new Error( `${ definition.type } does not define an edit action.` );
	}

	return definition.getEditAction;
}
