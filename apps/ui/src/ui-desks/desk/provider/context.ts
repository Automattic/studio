import { createContext, useContext } from 'react';
import type { DeskConfig } from '../types';
import type {
	DeskWidgetConnectionTarget,
	SelectedDeskConnectorToolbarItem,
} from '@/ui-desks/connectors/utils';
import type { getSelectedWidgetToolbarItem } from '@/ui-desks/desk/selection-toolbar/selection';
import type { DeskFocusDesk, DeskFocusMode } from '@/ui-desks/focus-mode/types';
import type { StackViewMode } from '@/ui-desks/stacks/utils';
import type {
	DeskWidget,
	DeskWidgetDefinition,
	WidgetPastePayload,
} from '@/ui-desks/widgets/types';
import type { ReactNode } from 'react';
import type { Editor, TLShapeId } from 'tldraw';

export type SelectedWidgetToolbarItem = NonNullable<
	ReturnType< typeof getSelectedWidgetToolbarItem >
>;

export type RegisterDeskEditor = ( editor: Editor | null ) => void;

export interface DeskContextValue {
	siteId?: string;
	isLoading: boolean;
	isReadOnly: boolean;
	statusMessage?: string;
	canAddWidgets: boolean;
	selectedWidgetToolbarItem: SelectedWidgetToolbarItem | null;
	selectedConnectorToolbarItem: SelectedDeskConnectorToolbarItem | null;
	selectedWidgetConnectionTargets: DeskWidgetConnectionTarget[];
	isConnectingWidget: boolean;
	focusMode: DeskFocusMode | null;
	focusedWidget: DeskWidget | null;
	focusedWidgetDefinition: DeskWidgetDefinition | null;
	siteCardEditAction: SiteCardEditAction | null;
	isSiteCardEditDirty: boolean;
	isSiteCardEditSaving: boolean;
	pressedStackId: string | null;
	registerEditor: RegisterDeskEditor;
	pressStack: ( stackId: string ) => void;
	addWidget: ( type: string, options?: AddDeskWidgetOptions ) => boolean;
	addWidgetAtScreenPoint: (
		type: string,
		point: { x: number; y: number },
		options?: Omit< AddDeskWidgetOptions, 'center' >
	) => boolean;
	addPastedContent: (
		payload: WidgetPastePayload,
		options?: AddDeskWidgetOptions
	) => Promise< boolean >;
	startDrawing: () => boolean;
	finishDrawing: () => Promise< boolean >;
	updateSelectedWidgetProps: ( widgetProps: Record< string, unknown > ) => boolean;
	updateSelectedWidgetShapeProps: ( shapeProps: Record< string, unknown > ) => boolean;
	canEditSelectedWidget: boolean;
	editSelectedWidget: () => boolean;
	requestSiteCardEditAction: ( action: 'save' | 'cancel' ) => boolean;
	completeSiteCardEdit: ( widgetId: string ) => void;
	setSiteCardEditDirty: ( widgetId: string, isDirty: boolean ) => void;
	setSiteCardEditSaving: ( widgetId: string, isSaving: boolean ) => void;
	fitSelectedWidgetToContent: () => Promise< boolean >;
	stackSelectedWidgets: () => boolean;
	unstackSelectedWidgets: () => boolean;
	setSelectedStackView: ( viewMode: StackViewMode ) => boolean;
	removeSelectedWidget: () => boolean;
	removeSelectedConnector: () => boolean;
	startConnectingWidget: ( shapeId: TLShapeId ) => boolean;
	focusConnectedWidget: ( shapeId: TLShapeId ) => boolean;
	startFocusMode: ( widgetId: string, focusDesk?: DeskFocusDesk ) => boolean;
	setFocusDesk: ( focusDesk: DeskFocusDesk ) => boolean;
	getFocusDeskSnapshot: () => DeskFocusDesk | null;
	stopFocusMode: () => boolean;
}

export interface SiteCardEditAction {
	widgetId: string;
	action: 'save' | 'cancel';
	token: number;
}

export interface AddDeskWidgetOptions {
	id?: string;
	center?: {
		x: number;
		y: number;
	};
	shapeProps?: Record< string, unknown >;
	widgetProps?: Record< string, unknown >;
	shouldStartEditing?: boolean;
}

export interface DeskProviderProps {
	siteId?: string;
	children: ReactNode;
	deskConfig?: DeskConfig;
	deskConfigKey?: string;
	initialViewportMode?: 'site-map';
	isLoading?: boolean;
	isReadOnly?: boolean;
	statusMessage?: string;
}

const defaultDeskContext: DeskContextValue = {
	siteId: undefined,
	isLoading: true,
	isReadOnly: false,
	statusMessage: undefined,
	canAddWidgets: false,
	selectedWidgetToolbarItem: null,
	selectedConnectorToolbarItem: null,
	selectedWidgetConnectionTargets: [],
	isConnectingWidget: false,
	focusMode: null,
	focusedWidget: null,
	focusedWidgetDefinition: null,
	siteCardEditAction: null,
	isSiteCardEditDirty: false,
	isSiteCardEditSaving: false,
	pressedStackId: null,
	registerEditor: noopRegisterEditor,
	pressStack: noopPressStack,
	addWidget: () => false,
	addWidgetAtScreenPoint: () => false,
	addPastedContent: () => Promise.resolve( false ),
	startDrawing: () => false,
	finishDrawing: async () => false,
	updateSelectedWidgetProps: () => false,
	updateSelectedWidgetShapeProps: () => false,
	canEditSelectedWidget: false,
	editSelectedWidget: () => false,
	requestSiteCardEditAction: () => false,
	completeSiteCardEdit: noopCompleteSiteCardEdit,
	setSiteCardEditDirty: noopSetSiteCardEditDirty,
	setSiteCardEditSaving: noopSetSiteCardEditSaving,
	fitSelectedWidgetToContent: () => Promise.resolve( false ),
	stackSelectedWidgets: () => false,
	unstackSelectedWidgets: () => false,
	setSelectedStackView: () => false,
	removeSelectedWidget: () => false,
	removeSelectedConnector: () => false,
	startConnectingWidget: () => false,
	focusConnectedWidget: () => false,
	startFocusMode: () => false,
	setFocusDesk: () => false,
	getFocusDeskSnapshot: () => null,
	stopFocusMode: () => false,
};

export const DeskContext = createContext< DeskContextValue >( defaultDeskContext );

export function useDesk() {
	return useContext( DeskContext );
}

export function useRegisterDeskEditor() {
	return useDesk().registerEditor;
}

function noopRegisterEditor() {}
function noopPressStack() {}
function noopCompleteSiteCardEdit() {}
function noopSetSiteCardEditDirty() {}
function noopSetSiteCardEditSaving() {}
