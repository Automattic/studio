import { useCallback, useEffect, useRef, useState } from 'react';
import { Tldraw, type Editor, type TldrawOptions } from 'tldraw';
import 'tldraw/tldraw.css';
import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';
import { deskShapeUtils } from '@/ui-desks/shapes/registry';
import styles from './style.module.css';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	deskWidgetToCanvasShape,
} from './tldraw-adapter';

const deskCanvasOptions = {
	createTextOnCanvasDoubleClick: false,
} satisfies Partial< TldrawOptions >;

interface UserDeskCanvasProps {
	desk: DeskConfig;
	onChange: ( desk: DeskConfig ) => void;
}

export function UserDeskCanvas( { desk, onChange }: UserDeskCanvasProps ) {
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const hydratedRef = useRef( false );
	const saveTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	const handleMount = useCallback( ( nextEditor: Editor ) => {
		setEditor( nextEditor );
	}, [] );

	useEffect( () => {
		if ( ! editor || hydratedRef.current ) {
			return;
		}

		hydratedRef.current = true;
		const existingShapes = editor.getCurrentPageShapes();
		if ( existingShapes.length > 0 ) {
			editor.deleteShapes( existingShapes.map( ( shape ) => shape.id ) );
		}
		if ( desk.widgets.length > 0 ) {
			editor.createShapes( desk.widgets.map( deskWidgetToCanvasShape ) );
		}
		if ( desk.viewport ) {
			editor.setCamera( desk.viewport, { immediate: true } );
		} else if ( desk.widgets.length > 0 ) {
			ensureContentVisible( editor );
		}
		editor.focus();
	}, [ desk, editor ] );

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		const queueSave = () => {
			if ( ! hydratedRef.current ) {
				return;
			}

			if ( saveTimerRef.current ) {
				clearTimeout( saveTimerRef.current );
			}

			saveTimerRef.current = setTimeout( () => {
				const widgets = editor
					.getCurrentPageShapes()
					.map( canvasShapeToDeskWidget )
					.filter( ( widget ) => widget !== null );
				onChange( {
					version: DESK_CONFIG_VERSION,
					updatedAt: new Date().toISOString(),
					viewport: canvasCameraToDeskViewport( editor.getCamera() ),
					widgets,
				} );
			}, 500 );
		};

		const unsubscribeDocument = editor.store.listen( queueSave, { scope: 'document' } );
		const unsubscribeCamera = editor.store.listen(
			( { changes } ) => {
				if ( hasCameraChange( changes ) ) {
					queueSave();
				}
			},
			{ scope: 'session' }
		);
		return () => {
			if ( saveTimerRef.current ) {
				clearTimeout( saveTimerRef.current );
			}
			unsubscribeDocument();
			unsubscribeCamera();
		};
	}, [ editor, onChange ] );

	return (
		<div className={ styles.canvas }>
			<Tldraw
				hideUi
				autoFocus
				options={ deskCanvasOptions }
				shapeUtils={ deskShapeUtils }
				onMount={ handleMount }
			/>
		</div>
	);
}

interface CanvasStoreChanges {
	added: Record< string, unknown >;
	updated: Record< string, readonly [ unknown, unknown ] >;
	removed: Record< string, unknown >;
}

function hasCameraChange( changes: CanvasStoreChanges ) {
	const updatedRecords = Object.values( changes.updated ).map( ( [ , nextRecord ] ) => nextRecord );
	const records = [
		...Object.values( changes.added ),
		...updatedRecords,
		...Object.values( changes.removed ),
	];
	return records.some( isCameraRecord );
}

function isCameraRecord( value: unknown ) {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		( value as { typeName?: unknown } ).typeName === 'camera'
	);
}

function ensureContentVisible( editor: Editor ) {
	const shapes = editor.getCurrentPageShapes();
	if ( shapes.length === 0 ) {
		return;
	}

	const viewport = editor.getViewportPageBounds();
	const hasVisibleShape = shapes.some( ( shape ) => {
		const bounds = editor.getShapePageBounds( shape.id );
		return bounds ? viewport.collides( bounds ) : false;
	} );

	if ( ! hasVisibleShape ) {
		editor.zoomToFit( { animation: { duration: 0 } } );
	}
}
