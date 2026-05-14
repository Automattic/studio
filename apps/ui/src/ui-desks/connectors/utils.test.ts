import { describe, expect, it, vi } from 'vitest';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import { getDeskWidgetConnectionLabel } from './utils';
import type { DeskWidget } from '@/ui-desks/widgets/types';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

describe( 'desk connections', () => {
	it( 'uses plain text for note connection labels', () => {
		expect(
			getDeskWidgetConnectionLabel( createNoteWidget( '<strong>Hello</strong> <em>world</em>' ) )
		).toBe( 'Hello world' );
	} );

	it( 'falls back to the default note label when note text is empty', () => {
		expect( getDeskWidgetConnectionLabel( createNoteWidget( '' ) ) ).toBe( 'Note' );
	} );

	it( 'uses the site card label for site card connections', () => {
		expect( getDeskWidgetConnectionLabel( createSiteCardWidget() ) ).toBe( 'Site card' );
	} );
} );

function createNoteWidget( text: string ): DeskWidget {
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
			text,
			tone: 'yellow',
		},
	};
}

function createSiteCardWidget(): DeskWidget {
	return {
		id: 'site-card-1',
		type: SITE_CARD_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a2',
		shapeProps: {
			w: 360,
			h: 200,
		},
		widgetProps: {
			siteId: 'site-1',
			previewVisible: false,
		},
	};
}
