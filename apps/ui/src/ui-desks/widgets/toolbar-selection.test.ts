import { describe, expect, it } from 'vitest';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { getSelectedWidgetToolbarItem } from './toolbar-selection';
import type { DeskWidget } from '@/ui-desks/widgets/types';

describe( 'widget toolbar selection', () => {
	it( 'returns the toolbar item for a single note widget selection', () => {
		const selectedItem = getSelectedWidgetToolbarItem( [ createNoteWidget() ] );

		expect( selectedItem?.definition.type ).toBe( NOTE_WIDGET_TYPE );
		expect( selectedItem?.widget.widgetProps ).toEqual( {
			text: 'Hello',
			tone: 'yellow',
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
