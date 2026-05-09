import { describe, expect, it, vi } from 'vitest';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { POST_WIDGET_TYPE } from '@/ui-desks/widgets/post/types';
import { getSelectedWidgetToolbarItem } from './toolbar-selection';
import type { DeskWidget } from '@/ui-desks/widgets/types';

vi.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: () => ( { record: null, isResolving: false } ),
	useEntityRecords: () => ( { records: null, isResolving: false, status: 'IDLE' } ),
} ) );

describe( 'widget toolbar selection', () => {
	it( 'returns the toolbar item for a single note widget selection', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createNoteWidget() ] );

		expect( selectedItem?.definition.type ).toBe( NOTE_WIDGET_TYPE );
		expect( selectedItem?.widget.widgetProps ).toEqual( {
			text: 'Hello',
			tone: 'yellow',
		} );
	} );

	it( 'returns the toolbar item for a single post widget selection', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createPostWidget() ] );

		expect( selectedItem?.definition.type ).toBe( POST_WIDGET_TYPE );
		expect( selectedItem?.definition.controls?.[ 0 ]?.type ).toBe( 'custom' );
		expect( selectedItem?.widget.widgetProps ).toEqual( {
			postId: 42,
		} );
	} );

	it( 'ignores empty and multi-widget selections', () => {
		const widget = createNoteWidget();

		expect( getSelectedWidgetToolbarItem( [] ) ).toBeNull();
		expect( getSelectedWidgetToolbarItem( [ widget, widget ] ) ).toBeNull();
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
