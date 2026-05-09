import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createDeskWidget } from '@/ui-desks/widgets/create-widget';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import { canvasShapeToDeskWidget, deskWidgetToCanvasShape } from './tldraw-adapter';
import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { ReactNode } from 'react';
import type { Editor } from 'tldraw';

interface DeskContextValue {
	canAddWidgets: boolean;
	addWidget: ( type: string ) => boolean;
	registerEditor: ( editor: Editor | null ) => void;
}

const DeskContext = createContext< DeskContextValue | null >( null );

export function DeskProvider( { children }: { children: ReactNode } ) {
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const creationOffsetRef = useRef( 0 );

	const addWidget = useCallback(
		( type: string ) => {
			if ( ! editor || ! getWidgetDefinition( type ) ) {
				return false;
			}

			const viewportCenter = editor.getViewportPageBounds().center;
			const offset = ( creationOffsetRef.current % 6 ) * 24;
			const widget = createDeskWidget( {
				id: createWidgetId(),
				type,
				center: {
					x: viewportCenter.x + offset,
					y: viewportCenter.y + offset,
				},
				zIndex: getNextZIndex( getCurrentDeskWidgets( editor ) ),
			} );

			if ( ! widget ) {
				return false;
			}

			const shape = deskWidgetToCanvasShape( widget );
			if ( ! shape.id ) {
				return false;
			}

			creationOffsetRef.current += 1;
			editor.createShape( shape ).select( shape.id );
			editor.setEditingShape( shape.id );
			editor.focus();
			return true;
		},
		[ editor ]
	);

	const value = useMemo(
		() => ( {
			canAddWidgets: Boolean( editor ),
			addWidget,
			registerEditor: setEditor,
		} ),
		[ addWidget, editor ]
	);

	return <DeskContext.Provider value={ value }>{ children }</DeskContext.Provider>;
}

export function useDesk() {
	return useContext( DeskContext );
}

export function useRegisterDeskEditor() {
	return useContext( DeskContext )?.registerEditor ?? noopRegisterEditor;
}

function getCurrentDeskWidgets( editor: Editor ) {
	return editor
		.getCurrentPageShapes()
		.map( canvasShapeToDeskWidget )
		.filter( ( widget ) => widget !== null );
}

function getNextZIndex( widgets: DeskWidget[] ) {
	const nextIndex =
		widgets.reduce( ( max, widget ) => {
			const numericIndex = Number( widget.zIndex.replace( /^a/, '' ) );
			return Number.isFinite( numericIndex ) ? Math.max( max, numericIndex ) : max;
		}, 0 ) + 1;

	return `a${ nextIndex }`;
}

function createWidgetId() {
	return globalThis.crypto?.randomUUID?.() ?? `widget-${ Date.now().toString( 36 ) }`;
}

function noopRegisterEditor() {}
