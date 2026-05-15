import { describe, expect, it, vi } from 'vitest';
import { MEDIA_WIDGET_TYPE } from '@/ui-desks/widgets/media/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { POST_WIDGET_TYPE } from '@/ui-desks/widgets/post/types';
import { SCRATCHPAD_WIDGET_TYPE } from '@/ui-desks/widgets/scratchpad/types';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import { getWidgetDropHandler } from './index';
import type { DeskWidget } from '@/ui-desks/widgets/types';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

describe( 'widget drop handlers', () => {
	it( 'returns the connector handler configured by the target widget', () => {
		expect( getWidgetDropHandler( createMediaWidget(), createNoteWidget() ) ).toMatchObject( {
			id: 'connect-widget-to-note',
			type: 'connector',
		} );
	} );

	it( 'does not return a target handler for unsupported source widget types', () => {
		expect( getWidgetDropHandler( createSitePreviewWidget(), createNoteWidget() ) ).toBeNull();
	} );

	it( 'does not return a handler for unsupported source and target pairs', () => {
		expect( getWidgetDropHandler( createMediaWidget(), createSitePreviewWidget() ) ).toBeNull();
	} );

	it( 'returns a connector handler for post and page drops onto site previews', () => {
		expect( getWidgetDropHandler( createPostWidget(), createSitePreviewWidget() ) ).toMatchObject( {
			id: 'preview-site-content',
			type: 'connector',
		} );
		expect( getWidgetDropHandler( createPageWidget(), createSitePreviewWidget() ) ).toMatchObject( {
			id: 'preview-site-content',
			type: 'connector',
		} );
	} );

	it( 'returns custom media handlers for post, page, and scratchpad targets', () => {
		const postHandler = getWidgetDropHandler(
			createMediaWidget( { mediaId: 123 } ),
			createPostWidget()
		);
		const pageHandler = getWidgetDropHandler(
			createMediaWidget( { mediaId: 123 } ),
			createPageWidget()
		);
		const scratchpadHandler = getWidgetDropHandler( createMediaWidget(), createScratchpadWidget() );

		expect( postHandler ).toMatchObject( {
			id: 'media-actions-for-post',
			type: 'custom',
		} );
		expect( pageHandler ).toMatchObject( {
			id: 'media-actions-for-page',
			type: 'custom',
		} );
		expect( scratchpadHandler ).toMatchObject( {
			id: 'media-actions-for-scratchpad',
			type: 'custom',
		} );
		expect( postHandler?.type === 'custom' ? postHandler.getActions : null ).toEqual(
			expect.any( Function )
		);
		expect( pageHandler?.type === 'custom' ? pageHandler.getActions : null ).toEqual(
			expect.any( Function )
		);
		expect( scratchpadHandler?.type === 'custom' ? scratchpadHandler.getActions : null ).toEqual(
			expect.any( Function )
		);
	} );

	it( 'does not return post or page media actions for local-only media', () => {
		const localMediaWidget = createMediaWidget( { mediaId: null } );

		expect( getWidgetDropHandler( localMediaWidget, createPostWidget() ) ).toBeNull();
		expect( getWidgetDropHandler( localMediaWidget, createPageWidget() ) ).toBeNull();
	} );
} );

function createMediaWidget( props: { mediaId?: number | null } = {} ): DeskWidget {
	return {
		id: 'media-1',
		type: MEDIA_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 320,
			h: 180,
		},
		widgetProps: {
			url: 'https://example.com/image.png',
			mediaKind: 'image',
			alt: '',
			mediaId: props.mediaId ?? null,
		},
	};
}

function createNoteWidget(): DeskWidget {
	return {
		id: 'note-1',
		type: NOTE_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a2',
		shapeProps: {
			w: 200,
			h: 200,
		},
		widgetProps: {
			text: '',
			tone: 'yellow',
		},
	};
}

function createSitePreviewWidget(): DeskWidget {
	return {
		id: 'site-preview-1',
		type: SITE_PREVIEW_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a3',
		shapeProps: {
			w: 960,
			h: 540,
		},
		widgetProps: {
			path: '/',
		},
	};
}

function createPostWidget(): DeskWidget {
	return {
		id: 'post-1',
		type: POST_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a3',
		shapeProps: {
			w: 280,
			h: 380,
		},
		widgetProps: {
			postId: 123,
		},
	};
}

function createPageWidget(): DeskWidget {
	return {
		id: 'page-1',
		type: PAGE_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a4',
		shapeProps: {
			w: 280,
			h: 380,
		},
		widgetProps: {
			pageId: 456,
			tone: 'neutral',
		},
	};
}

function createScratchpadWidget(): DeskWidget {
	return {
		id: 'scratchpad-1',
		type: SCRATCHPAD_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a5',
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
	};
}
