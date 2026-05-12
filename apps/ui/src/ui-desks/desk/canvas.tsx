import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Tldraw, type Editor, type TLComponents, type TldrawOptions } from 'tldraw';
import 'tldraw/tldraw.css';
import { deskShapeUtils } from '@/ui-desks/shapes/registry';
import {
	StackAwareSelectionForeground,
	StackCanvasOverlays,
} from '@/ui-desks/stacks/canvas-components';
import {
	DeskCanvasContextMenu,
	resolveDeskContextMenuState,
	type DeskContextMenuState,
} from './context-menu';
import { DeskDrawingToolbar } from './drawing-toolbar';
import { useDesk, useRegisterDeskEditor } from './provider';
import styles from './style.module.css';
import { TldrawHoverStateSync } from './tldraw-hover-state-sync';

const deskCanvasComponents = {
	ContextMenu: null,
	InFrontOfTheCanvas: DeskCanvasOverlays,
	SelectionForeground: StackAwareSelectionForeground,
} satisfies Partial< TLComponents >;

function DeskCanvasOverlays() {
	return (
		<>
			<TldrawHoverStateSync />
			<StackCanvasOverlays />
			<DeskDrawingToolbar />
		</>
	);
}

export function DeskCanvas() {
	const { isLoading, isReadOnly, statusMessage } = useDesk();
	const registerEditor = useRegisterDeskEditor();
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const [ contextMenu, setContextMenu ] = useState< DeskContextMenuState | null >( null );
	const canvasOptions = useMemo(
		() =>
			( {
				createTextOnCanvasDoubleClick: ! isReadOnly,
			} ) satisfies Partial< TldrawOptions >,
		[ isReadOnly ]
	);

	const handleMount = useCallback(
		( nextEditor: Editor ) => {
			setEditor( nextEditor );
			registerEditor( nextEditor );
		},
		[ registerEditor ]
	);

	useEffect( () => {
		return () => {
			setEditor( null );
			setContextMenu( null );
			registerEditor( null );
		};
	}, [ registerEditor ] );

	const handleContextMenu = useCallback(
		( event: MouseEvent< HTMLDivElement > ) => {
			if ( ! editor || isReadOnly ) {
				return;
			}

			const target = event.target as HTMLElement | null;
			if ( target?.closest( '[data-ui-desks-context-menu]' ) ) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			setContextMenu( resolveDeskContextMenuState( editor, event.clientX, event.clientY ) );
		},
		[ editor, isReadOnly ]
	);

	if ( isLoading ) {
		return <div className={ styles.loading } />;
	}

	return (
		<div className={ styles.canvas } onContextMenu={ handleContextMenu }>
			<Tldraw
				hideUi
				autoFocus
				options={ canvasOptions }
				components={ deskCanvasComponents }
				shapeUtils={ deskShapeUtils }
				onMount={ handleMount }
			/>
			{ statusMessage && <div className={ styles.statusMessage }>{ statusMessage }</div> }
			{ contextMenu && editor && (
				<DeskCanvasContextMenu
					editor={ editor }
					state={ contextMenu }
					onClose={ () => setContextMenu( null ) }
				/>
			) }
		</div>
	);
}
