import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createShapeId, type Editor } from 'tldraw';
import { createWidgetShape } from '@/ui-desks/widgets/create-widget';
import type { ReactNode } from 'react';

interface DeskActions {
	canCreateWidgets: boolean;
	createWidget: ( type: string ) => boolean;
	registerEditor: ( editor: Editor | null ) => void;
}

const DeskActionsContext = createContext< DeskActions | null >( null );

export function DeskActionsProvider( { children }: { children: ReactNode } ) {
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const creationOffsetRef = useRef( 0 );

	const createWidget = useCallback(
		( type: string ) => {
			if ( ! editor ) {
				return false;
			}

			const viewportCenter = editor.getViewportPageBounds().center;
			const offset = ( creationOffsetRef.current % 6 ) * 24;

			const createdWidget = createWidgetShape( {
				id: createShapeId(),
				type,
				center: {
					x: viewportCenter.x + offset,
					y: viewportCenter.y + offset,
				},
			} );

			if ( ! createdWidget ) {
				return false;
			}

			creationOffsetRef.current += 1;
			editor.createShape( createdWidget.shape ).select( createdWidget.shape.id );
			if ( createdWidget.startEditing ) {
				editor.setEditingShape( createdWidget.shape.id );
			}
			editor.focus();
			return true;
		},
		[ editor ]
	);

	const value = useMemo(
		() => ( {
			canCreateWidgets: Boolean( editor ),
			createWidget,
			registerEditor: setEditor,
		} ),
		[ createWidget, editor ]
	);

	return <DeskActionsContext.Provider value={ value }>{ children }</DeskActionsContext.Provider>;
}

export function useDeskActions() {
	return useContext( DeskActionsContext );
}

export function useRegisterDeskEditor() {
	return useContext( DeskActionsContext )?.registerEditor ?? noopRegisterEditor;
}

function noopRegisterEditor() {}
