import { createContext, useContext } from 'react';
import type { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';
import type { ReactNode } from 'react';
import type { Editor } from 'tldraw';

export type SelectedWidgetToolbarItem = NonNullable<
	ReturnType< typeof getSelectedWidgetToolbarItem >
>;

export type RegisterDeskEditor = ( editor: Editor | null ) => void;

export interface DeskContextValue {
	siteId?: string;
	isLoading: boolean;
	canAddWidgets: boolean;
	selectedWidgetToolbarItem: SelectedWidgetToolbarItem | null;
	pressedStackId: string | null;
	registerEditor: RegisterDeskEditor;
	pressStack: ( stackId: string ) => void;
	addWidget: ( type: string, options?: AddDeskWidgetOptions ) => boolean;
	updateSelectedWidgetProps: ( widgetProps: Record< string, unknown > ) => boolean;
	stackSelectedWidgets: () => boolean;
	unstackSelectedWidgets: () => boolean;
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
}

const defaultDeskContext: DeskContextValue = {
	siteId: undefined,
	isLoading: true,
	canAddWidgets: false,
	selectedWidgetToolbarItem: null,
	pressedStackId: null,
	registerEditor: noopRegisterEditor,
	pressStack: noopPressStack,
	addWidget: () => false,
	updateSelectedWidgetProps: () => false,
	stackSelectedWidgets: () => false,
	unstackSelectedWidgets: () => false,
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
