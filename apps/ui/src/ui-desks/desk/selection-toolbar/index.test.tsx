import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesk } from '@/ui-desks/desk/provider';
import {
	SiteCardEditCancelControl,
	SiteCardEditSaveControl,
} from '@/ui-desks/widgets/site-card/edit-controls';
import { registerSiteCardEditSession } from '@/ui-desks/widgets/site-card/edit-session';
import { SiteCardPreviewControl } from '@/ui-desks/widgets/site-card/preview-control';
import { isSiteCardWidgetProps, SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import { DeskWidgetToolbar } from './index';
import type { SelectedWidgetToolbarItem } from './selection';
import type { DeskContextValue } from '@/ui-desks/desk/provider/context';
import type { DeskWidget, DeskWidgetDefinition } from '@/ui-desks/widgets/types';

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
	const editSelectedWidget = vi.fn();

	beforeEach( () => {
		editSelectedWidget.mockReturnValue( true );
		fitSelectedWidgetToContent.mockResolvedValue( true );
		useDeskMock.mockReturnValue( createDeskContext() );
	} );

	it( 'renders a standard edit button when the selected widget has an edit action', () => {
		useDeskMock.mockReturnValue(
			createDeskContext( {
				selectedWidgetToolbarItem: createSingleWidgetSelection( {
					labels: {
						add: () => 'New test widget',
						edit: () => 'Edit test widget',
					},
					getEditAction: () => ( { kind: 'canvas-editing' as const } ),
				} ),
				canEditSelectedWidget: true,
				editSelectedWidget,
			} )
		);

		render( <DeskWidgetToolbar /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Edit test widget' } ) );

		expect( editSelectedWidget ).toHaveBeenCalledTimes( 1 );
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

	it( 'renders focus mode controls from the focused widget definition', () => {
		const focusedWidget = createWidget();
		useDeskMock.mockReturnValue(
			createDeskContext( {
				focusMode: {
					widgetId: focusedWidget.id,
					focusDesk: { widgets: [] },
				},
				focusedWidget: focusedWidget as unknown as DeskWidget,
				focusedWidgetDefinition: {
					...createWidgetDefinition(),
					focusModeControls: [
						{
							type: 'custom',
							id: 'focus-action',
							Component: () => <button type="button">Focus action</button>,
						},
					],
					focusModeControlsLabel: () => 'Focused test actions',
				} as DeskWidgetDefinition,
			} )
		);

		render( <DeskWidgetToolbar /> );

		expect( screen.getByRole( 'toolbar', { name: 'Focused test actions' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Focus action' } ) ).toBeVisible();
	} );

	it( 'renders the site-card camera preview control in the selection toolbar', () => {
		const updateSelectedWidgetProps = vi.fn();
		const fitSelectedWidgetToContent = vi.fn().mockResolvedValue( true );
		useDeskMock.mockReturnValue(
			createDeskContext( {
				selectedWidgetToolbarItem: createSiteCardSelection(),
				updateSelectedWidgetProps,
				fitSelectedWidgetToContent,
			} )
		);

		render( <DeskWidgetToolbar /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Show preview' } ) );

		expect( updateSelectedWidgetProps ).toHaveBeenCalledWith( { previewVisible: true } );
		expect( fitSelectedWidgetToContent ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'renders site-card save and cancel actions as focus mode controls', () => {
		const requestAction = vi.fn();
		const focusedWidget = createSiteCardWidget();
		const unregister = registerSiteCardEditSession( focusedWidget.id, {
			isDirty: true,
			isSaving: false,
			canSave: true,
			requestAction,
		} );
		useDeskMock.mockReturnValue(
			createDeskContext( {
				focusMode: {
					widgetId: focusedWidget.id,
					focusDesk: { widgets: [] },
				},
				focusedWidget: focusedWidget as DeskWidget,
				focusedWidgetDefinition: createSiteCardWidgetDefinition( {
					focusModeControls: [
						{
							type: 'custom',
							id: 'cancel-site-card-edit',
							Component: SiteCardEditCancelControl,
						},
						{
							type: 'custom',
							id: 'save-site-card-edit',
							Component: SiteCardEditSaveControl,
						},
					],
					focusModeControlsLabel: () => 'Edit site identity actions',
				} ),
			} )
		);

		render( <DeskWidgetToolbar /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( requestAction ).toHaveBeenCalledWith( 'save' );
		expect( requestAction ).toHaveBeenCalledWith( 'cancel' );
		unregister();
	} );

	it( 'shows a busy save button while the site card is saving', () => {
		const requestAction = vi.fn();
		const focusedWidget = createSiteCardWidget();
		const unregister = registerSiteCardEditSession( focusedWidget.id, {
			isDirty: true,
			isSaving: true,
			canSave: true,
			requestAction,
		} );
		useDeskMock.mockReturnValue(
			createDeskContext( {
				focusMode: {
					widgetId: focusedWidget.id,
					focusDesk: { widgets: [] },
				},
				focusedWidget: focusedWidget as DeskWidget,
				focusedWidgetDefinition: createSiteCardWidgetDefinition( {
					focusModeControls: [
						{
							type: 'custom',
							id: 'cancel-site-card-edit',
							Component: SiteCardEditCancelControl,
						},
						{
							type: 'custom',
							id: 'save-site-card-edit',
							Component: SiteCardEditSaveControl,
						},
					],
					focusModeControlsLabel: () => 'Edit site identity actions',
				} ),
			} )
		);

		render( <DeskWidgetToolbar /> );

		const saveButton = screen.getByRole( 'button', { name: 'Saving site identity' } );

		expect( saveButton ).toBeDisabled();
		expect( saveButton ).toHaveAttribute( 'aria-busy', 'true' );
		expect( screen.getByText( 'Saving' ) ).toBeVisible();
		fireEvent.click( saveButton );
		expect( requestAction ).not.toHaveBeenCalled();
		unregister();
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
		selectedConnectorToolbarItem: null,
		selectedWidgetConnectionTargets: [],
		isConnectingWidget: false,
		focusMode: null,
		focusedWidget: null,
		focusedWidgetDefinition: null,
		pressedStackId: null,
		registerEditor: vi.fn(),
		pressStack: vi.fn(),
		addWidget: vi.fn(),
		addWidgetAtScreenPoint: vi.fn(),
		addPastedContent: vi.fn().mockResolvedValue( false ),
		startDrawing: vi.fn(),
		finishDrawing: vi.fn().mockResolvedValue( false ),
		updateSelectedWidgetProps: vi.fn(),
		canEditSelectedWidget: false,
		editSelectedWidget: vi.fn(),
		canPreviewContentInSitePreview: false,
		previewContentInSitePreview: vi.fn().mockResolvedValue( false ),
		fitSelectedWidgetToContent: vi.fn().mockResolvedValue( false ),
		stackSelectedWidgets: vi.fn(),
		unstackSelectedWidgets: vi.fn(),
		setSelectedStackView: vi.fn(),
		runSelectedWidgetAction: vi.fn(),
		removeSelectedWidget: vi.fn(),
		removeSelectedConnector: vi.fn(),
		startConnectingWidget: vi.fn(),
		focusConnectedWidget: vi.fn(),
		startFocusMode: vi.fn(),
		setFocusDesk: vi.fn(),
		getFocusDeskSnapshot: vi.fn(),
		stopFocusMode: vi.fn(),
		getDeskConfigSnapshot: vi.fn(),
		replaceDeskConfig: vi.fn().mockResolvedValue( false ),
		...overrides,
	};
}

function createSingleWidgetSelection(
	definitionOverrides: Partial< DeskWidgetDefinition > = {}
): SelectedWidgetToolbarItem {
	const widget = createWidget();

	return {
		kind: 'single-widget',
		widgets: [ widget ],
		stackIds: [],
		canStack: false,
		canUnstack: false,
		canSetStackView: false,
		canRemove: true,
		widget,
		definition: createWidgetDefinition( definitionOverrides ),
	} as unknown as SelectedWidgetToolbarItem;
}

function createWidget() {
	return {
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
}

function createWidgetDefinition( overrides: Partial< DeskWidgetDefinition > = {} ) {
	return {
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
		...overrides,
	} as DeskWidgetDefinition;
}

function createSiteCardSelection(): SelectedWidgetToolbarItem {
	const widget = createSiteCardWidget();

	return {
		kind: 'single-widget',
		widgets: [ widget ],
		stackIds: [],
		canStack: false,
		canUnstack: false,
		canSetStackView: false,
		canRemove: true,
		widget,
		definition: createSiteCardWidgetDefinition(),
	} as unknown as SelectedWidgetToolbarItem;
}

function createSiteCardWidget() {
	return {
		id: 'site-card-1',
		type: SITE_CARD_WIDGET_TYPE,
		x: 0,
		y: 0,
		zIndex: 'a1',
		shapeProps: {
			w: 360,
			h: 200,
		},
		widgetProps: {
			previewVisible: false,
		},
	};
}

function createSiteCardWidgetDefinition(
	overrides: Partial< DeskWidgetDefinition > = {}
): DeskWidgetDefinition {
	return {
		type: SITE_CARD_WIDGET_TYPE,
		name: () => 'Site card',
		Component: () => null,
		controls: [
			{
				type: 'custom',
				id: 'site-card-preview',
				Component: SiteCardPreviewControl,
			},
		],
		isWidgetProps: isSiteCardWidgetProps,
		labels: {
			add: () => 'New site card',
		},
		getInitialWidget: () => ( {
			shapeProps: {
				w: 360,
				h: 200,
			},
			widgetProps: {
				previewVisible: false,
			},
		} ),
		...overrides,
	} as DeskWidgetDefinition;
}
