import { describe, expect, it, vi } from 'vitest';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { getDeskWidgetConnectionLabel } from './connections';
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
