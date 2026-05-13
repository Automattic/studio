import { createContext, useContext } from 'react';
import type { DeskConfig } from '../types';
import type { getSelectedWidgetToolbarItem } from '@/ui-desks/desk/selection-toolbar/selection';
import type { StackViewMode } from '@/ui-desks/stacks/utils';
import type { WidgetPastePayload } from '@/ui-desks/widgets/types';
import type { ReactNode } from 'react';
import type { Editor } from 'tldraw';

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
	pressedStackId: string | null;
	registerEditor: RegisterDeskEditor;
	pressStack: ( stackId: string ) => void;
	addWidget: ( type: string, options?: AddDeskWidgetOptions ) => boolean;
	addPastedContent: (
		payload: WidgetPastePayload,
		options?: AddDeskWidgetOptions
	) => Promise< boolean >;
	startDrawing: () => boolean;
	finishDrawing: () => Promise< boolean >;
	updateSelectedWidgetProps: ( widgetProps: Record< string, unknown > ) => boolean;
	canEditSelectedWidget: boolean;
	editSelectedWidget: () => boolean;
	fitSelectedWidgetToContent: () => Promise< boolean >;
	stackSelectedWidgets: () => boolean;
	unstackSelectedWidgets: () => boolean;
	setSelectedStackView: ( viewMode: StackViewMode ) => boolean;
	removeSelectedWidget: () => boolean;
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
	pressedStackId: null,
	registerEditor: noopRegisterEditor,
	pressStack: noopPressStack,
	addWidget: () => false,
	addPastedContent: () => Promise.resolve( false ),
	startDrawing: () => false,
	finishDrawing: async () => false,
	updateSelectedWidgetProps: () => false,
	canEditSelectedWidget: false,
	editSelectedWidget: () => false,
	fitSelectedWidgetToContent: () => Promise.resolve( false ),
	stackSelectedWidgets: () => false,
	unstackSelectedWidgets: () => false,
	setSelectedStackView: () => false,
	removeSelectedWidget: () => false,
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
