import { useCallback, useEffect, useMemo } from 'react';
import { Tldraw, type Editor, type TLComponents, type TldrawOptions } from 'tldraw';
import 'tldraw/tldraw.css';
import { deskShapeUtils } from '@/ui-desks/shapes/registry';
import {
	StackAwareSelectionForeground,
	StackCanvasOverlays,
} from '@/ui-desks/stacks/canvas-components';
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
	const canvasOptions = useMemo(
		() =>
			( {
				createTextOnCanvasDoubleClick: ! isReadOnly,
			} ) satisfies Partial< TldrawOptions >,
		[ isReadOnly ]
	);

	const handleMount = useCallback(
		( nextEditor: Editor ) => {
			registerEditor( nextEditor );
		},
		[ registerEditor ]
	);

	useEffect( () => {
		return () => {
			registerEditor( null );
		};
	}, [ registerEditor ] );

	if ( isLoading ) {
		return <div className={ styles.loading } />;
	}

	return (
		<div className={ styles.canvas }>
			<Tldraw
				hideUi
				autoFocus
				options={ canvasOptions }
				components={ deskCanvasComponents }
				shapeUtils={ deskShapeUtils }
				onMount={ handleMount }
			/>
			{ statusMessage && <div className={ styles.statusMessage }>{ statusMessage }</div> }
		</div>
	);
}
