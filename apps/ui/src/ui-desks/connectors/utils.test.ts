import { describe, expect, it, vi } from 'vitest';
import { DESK_CONFIG_VERSION } from '@/ui-desks/desk/types';
import { NOTE_WIDGET_TYPE, type NoteTone } from '@/ui-desks/widgets/note/types';
import { SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import {
	appendIncomingConnectedWidgets,
	getDeskWidgetConnectionLabel,
	getDeskWidgetConnectionPillBg,
	getDeskWidgetConnectionTitle,
} from './context';
import type { DeskConfig } from '@/ui-desks/desk/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

vi.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

describe( 'desk connections', () => {
	it( 'uses a compact note connection label and keeps note text as the title', () => {
		const widget = createNoteWidget( '<strong>Hello</strong> <em>world</em>' );

		expect( getDeskWidgetConnectionLabel( widget ) ).toBe( 'Note' );
		expect( getDeskWidgetConnectionTitle( widget ) ).toBe( 'Hello world' );
	} );

	it( 'falls back to the default note label when note text is empty', () => {
		expect( getDeskWidgetConnectionLabel( createNoteWidget( '' ) ) ).toBe( 'Note' );
	} );

	it( 'uses note tone colors for source pills', () => {
		expect( getDeskWidgetConnectionPillBg( createNoteWidget( '', 'blue' ) ) ).toBe( '#2271b1' );
	} );

	it( 'uses the site card label for site card connections', () => {
		expect( getDeskWidgetConnectionLabel( createSiteCardWidget() ) ).toBe( 'Site card' );
	} );

	it( 'appends incoming connected sources to chat context in selection order', () => {
		const source = createSiteCardWidget();
		const target = createNoteWidget( 'Use this' );
		const otherTarget = createNoteWidget( 'Other' );
		const deskConfig: DeskConfig = {
			version: DESK_CONFIG_VERSION,
			updatedAt: '2026-05-15T00:00:00.000Z',
			widgets: [ source, target, otherTarget ],
			connectors: [
				{
					id: 'site-card-to-note',
					from: {
						widgetId: source.id,
						normalizedAnchor: { x: 0.5, y: 0.5 },
					},
					to: {
						widgetId: target.id,
						normalizedAnchor: { x: 0.5, y: 0.5 },
					},
				},
			],
		};

		expect( appendIncomingConnectedWidgets( [ target, otherTarget ], deskConfig ) ).toEqual( [
			target,
			otherTarget,
			source,
		] );
	} );
} );

function createNoteWidget( text: string, tone: NoteTone = 'yellow' ): DeskWidget {
	return {
		id: `note-${ text || tone }`,
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
			tone,
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
