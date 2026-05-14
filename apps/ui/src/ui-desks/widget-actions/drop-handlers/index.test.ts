import { describe, expect, it, vi } from 'vitest';
import { MEDIA_WIDGET_TYPE } from '@/ui-desks/widgets/media/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
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

	it( 'does not return a handler when the target has no drop handlers', () => {
		expect( getWidgetDropHandler( createNoteWidget(), createSitePreviewWidget() ) ).toBeNull();
	} );
} );

function createMediaWidget(): DeskWidget {
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
			mediaId: null,
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
