import { describe, expect, it, vi } from 'vitest';
import { artefactWidgetDefinition } from '@/ui-desks/widgets/artefact/definition';
import { noteWidgetDefinition } from '@/ui-desks/widgets/note/definition';
import { pageWidgetDefinition } from '@/ui-desks/widgets/page/definition';
import { postWidgetDefinition } from '@/ui-desks/widgets/post/definition';
import { postCollectionWidgetDefinition } from '@/ui-desks/widgets/post-collection/definition';
import { sitePreviewWidgetDefinition } from '@/ui-desks/widgets/site-preview/definition';
import type { ArtefactWidget } from '@/ui-desks/widgets/artefact/types';
import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { PageWidget } from '@/ui-desks/widgets/page/types';
import type { PostWidget } from '@/ui-desks/widgets/post/types';
import type { PostCollectionWidget } from '@/ui-desks/widgets/post-collection/types';
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
			getEditAction( artefactWidgetDefinition )( {
				widget: createArtefactWidget(),
				hasSiteId: false,
				hasRunningSite: false,
			} )
		).toEqual( { kind: 'canvas-editing' } );
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

function createArtefactWidget(): ArtefactWidget {
	return {
		...createWidgetBase( 'sd-artefact' ),
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
