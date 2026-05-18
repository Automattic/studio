import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
	COLOR_WIDGET_DRAG_MIME_TYPE,
	COLOR_WIDGET_DRAG_TITLE_MIME_TYPE,
	type ColorWidgetProps,
} from '../types';
import { ColorWidgetComponent } from './index';

function renderColorWidget(
	widgetProps: ColorWidgetProps,
	options: { isTemporary?: boolean } = {}
) {
	render(
		<ColorWidgetComponent
			id="color-1"
			widgetProps={ widgetProps }
			isEditing={ false }
			isHovered={ false }
			isSelected={ false }
			isTemporary={ options.isTemporary }
			onWidgetPropsChange={ vi.fn() }
			onEditComplete={ vi.fn() }
		/>
	);

	const card = screen.getByText( widgetProps.color ).closest( '[data-studio-desk-widget="color"]' );
	if ( ! card ) {
		throw new Error( 'Expected color widget card.' );
	}
	return card as HTMLElement;
}

describe( 'ColorWidgetComponent', () => {
	it( 'marks temporary color widgets as draggable swatches', () => {
		const card = renderColorWidget( { color: '#ff8800', title: 'Accent' }, { isTemporary: true } );
		expect( card.draggable ).toBe( true );

		const data = new Map< string, string >();
		const dataTransfer = {
			effectAllowed: 'uninitialized',
			setData: vi.fn( ( key: string, value: string ) => {
				data.set( key, value );
			} ),
		} as unknown as DataTransfer;

		fireEvent.dragStart( card, { dataTransfer } );

		expect( dataTransfer.effectAllowed ).toBe( 'copy' );
		expect( data.get( COLOR_WIDGET_DRAG_MIME_TYPE ) ).toBe( '#ff8800' );
		expect( data.get( COLOR_WIDGET_DRAG_TITLE_MIME_TYPE ) ).toBe( 'Accent' );
		expect( data.get( 'text/plain' ) ).toBe( '#ff8800' );
	} );

	it( 'keeps persistent color widgets in the tldraw drag path', () => {
		const card = renderColorWidget( { color: '#ff8800', title: 'Accent' } );
		expect( card.draggable ).toBe( false );
	} );
} );
