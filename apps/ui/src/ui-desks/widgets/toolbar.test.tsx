import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesk } from '@/ui-desks/desk/provider';
import { DeskWidgetToolbar } from './toolbar';
import type { SelectedWidgetToolbarItem } from './toolbar-selection';
import type { DeskContextValue } from '@/ui-desks/desk/provider/context';
import type { DeskWidgetDefinition } from '@/ui-desks/widgets/types';

vi.mock( '@/ui-desks/chats/chat-button', () => ( {
	ChatButton: () => <button type="button">Chat</button>,
} ) );

vi.mock( '@/ui-desks/chats/selection-chat-dialog', () => ( {
	SelectionChatDialog: () => null,
} ) );

vi.mock( '@/ui-desks/desk/provider', () => ( {
	useDesk: vi.fn(),
} ) );

const useDeskMock = vi.mocked( useDesk );

describe( 'DeskWidgetToolbar', () => {
	const fitSelectedWidgetToContent = vi.fn();

	beforeEach( () => {
		fitSelectedWidgetToContent.mockResolvedValue( true );
		useDeskMock.mockReturnValue( createDeskContext() );
	} );

	it( 'renders a generic fit button when the selected widget definition supports fitting', () => {
		useDeskMock.mockReturnValue(
			createDeskContext( {
				selectedWidgetToolbarItem: createSingleWidgetSelection( {
					getFittedShapeProps: () => ( { w: 200, h: 100 } ),
				} ),
				fitSelectedWidgetToContent,
			} )
		);

		render( <DeskWidgetToolbar /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Fit to size' } ) );

		expect( fitSelectedWidgetToContent ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not render a fit button when the selected widget definition does not support fitting', () => {
		useDeskMock.mockReturnValue(
			createDeskContext( {
				selectedWidgetToolbarItem: createSingleWidgetSelection(),
			} )
		);

		render( <DeskWidgetToolbar /> );

		expect( screen.queryByRole( 'button', { name: 'Fit to size' } ) ).not.toBeInTheDocument();
	} );
} );

function createDeskContext( overrides: Partial< DeskContextValue > = {} ): DeskContextValue {
	return {
		siteId: undefined,
		isLoading: false,
		isReadOnly: false,
		statusMessage: undefined,
		canAddWidgets: true,
		selectedWidgetToolbarItem: null,
		pressedStackId: null,
		registerEditor: vi.fn(),
		pressStack: vi.fn(),
		addWidget: vi.fn(),
		addPastedContent: vi.fn().mockResolvedValue( false ),
		startDrawing: vi.fn(),
		finishDrawing: vi.fn().mockResolvedValue( false ),
		updateSelectedWidgetProps: vi.fn(),
		fitSelectedWidgetToContent: vi.fn().mockResolvedValue( false ),
		stackSelectedWidgets: vi.fn(),
		unstackSelectedWidgets: vi.fn(),
		removeSelectedWidget: vi.fn(),
		...overrides,
	};
}

function createSingleWidgetSelection(
	definitionOverrides: Partial< DeskWidgetDefinition > = {}
): SelectedWidgetToolbarItem {
	const widget = {
		id: 'widget-1',
		type: 'test-widget',
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 200,
			h: 200,
		},
		widgetProps: {},
	};

	return {
		kind: 'single-widget',
		widgets: [ widget ],
		stackIds: [],
		canStack: false,
		canUnstack: false,
		canRemove: true,
		widget,
		definition: {
			type: 'test-widget',
			name: () => 'Test widget',
			Component: () => null,
			isWidgetProps: () => true,
			labels: {
				add: () => 'New test widget',
			},
			getInitialWidget: () => ( {
				shapeProps: {
					w: 200,
					h: 200,
				},
				widgetProps: {},
			} ),
			...definitionOverrides,
		} as DeskWidgetDefinition,
	} as unknown as SelectedWidgetToolbarItem;
}
