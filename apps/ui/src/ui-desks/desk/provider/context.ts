import { createContext, useContext } from 'react';
import type { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';
import type { ReactNode } from 'react';
import type { Editor } from 'tldraw';

export type SelectedWidgetToolbarItem = NonNullable<
	ReturnType< typeof getSelectedWidgetToolbarItem >
>;

export interface DeskContextValue {
	siteId?: string;
	isLoading: boolean;
	canAddWidgets: boolean;
	selectedWidgetToolbarItem: SelectedWidgetToolbarItem | null;
	addWidget: ( type: string, options?: AddDeskWidgetOptions ) => boolean;
	updateSelectedWidgetProps: ( widgetProps: Record< string, unknown > ) => boolean;
	removeSelectedWidget: () => boolean;
}

export interface AddDeskWidgetOptions {
	shapeProps?: Record< string, unknown >;
	widgetProps?: Record< string, unknown >;
	shouldStartEditing?: boolean;
}

export interface DeskProviderProps {
	siteId?: string;
	children: ReactNode;
}

export type RegisterDeskEditor = ( editor: Editor | null ) => void;

const defaultDeskContext: DeskContextValue = {
	siteId: undefined,
	isLoading: true,
	canAddWidgets: false,
	selectedWidgetToolbarItem: null,
	addWidget: () => false,
	updateSelectedWidgetProps: () => false,
	removeSelectedWidget: () => false,
};

export const DeskContext = createContext< DeskContextValue >( defaultDeskContext );
export const DeskEditorRegistrationContext =
	createContext< RegisterDeskEditor >( noopRegisterEditor );

export function useDesk() {
	return useContext( DeskContext );
}

export function useRegisterDeskEditor() {
	return useContext( DeskEditorRegistrationContext );
}

function noopRegisterEditor() {}
