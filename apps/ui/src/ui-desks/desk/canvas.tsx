import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
} from 'react';
import { Tldraw, type Editor, type TLComponents, type TLShape, type TldrawOptions } from 'tldraw';
import 'tldraw/tldraw.css';
import { useChats } from '@/ui-desks/chats/context';
import { canvasShapeToDeskWidget } from '@/ui-desks/desk/tldraw-adapter';
import { deskShapeUtils } from '@/ui-desks/shapes/registry';
import {
	StackAwareSelectionForeground,
	StackCanvasOverlays,
} from '@/ui-desks/stacks/canvas-components';
import { DeskCanvasContextMenu } from './context-menu';
import { resolveDeskContextMenuState, type DeskContextMenuState } from './context-menu-state';
import { DeskDrawingToolbar } from './drawing-toolbar';
import { useDesk, useRegisterDeskEditor } from './provider';
import styles from './style.module.css';
import { TldrawHoverStateSync } from './tldraw-hover-state-sync';
import type { DeskWidget } from '@/ui-desks/widgets/types';

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
	const { attachWidgetsToComposer, setComposerWidgetDragPreview, setComposerWidgetDragTarget } =
		useChats();
	const registerEditor = useRegisterDeskEditor();
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const [ contextMenu, setContextMenu ] = useState< DeskContextMenuState | null >( null );
	const stopTrackingWidgetDragRef = useRef< ( () => void ) | null >( null );
	const isComposerDragTargetRef = useRef( false );
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
			stopTrackingWidgetDragRef.current?.();
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

	const handlePointerDown = useCallback(
		( event: ReactPointerEvent< HTMLDivElement > ) => {
			if ( ! editor || event.button !== 0 ) {
				return;
			}

			const target = event.target as HTMLElement | null;
			if ( ! target || shouldIgnoreWidgetDragSource( target ) ) {
				return;
			}

			const hitShape = getShapeAtScreenPoint( editor, event.clientX, event.clientY );
			if ( ! hitShape || ! canvasShapeToDeskWidget( hitShape ) ) {
				return;
			}

			stopTrackingWidgetDragRef.current?.();

			const state: CanvasWidgetDragState = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				hitShapeId: hitShape.id,
				didMove: false,
				widgets: null,
				shapeSnapshots: null,
			};

			const clearComposerDragTarget = () => {
				if ( isComposerDragTargetRef.current ) {
					isComposerDragTargetRef.current = false;
					setComposerWidgetDragTarget( false );
				}
				setComposerWidgetDragPreview( undefined );
			};

			const cleanup = () => {
				window.removeEventListener( 'pointermove', handlePointerMove, true );
				window.removeEventListener( 'pointerup', handlePointerUp, true );
				window.removeEventListener( 'pointercancel', handlePointerCancel, true );
				clearComposerDragTarget();
				stopTrackingWidgetDragRef.current = null;
			};

			const resolveDragWidgets = () => {
				if ( state.widgets ) {
					return state.widgets;
				}

				const shapeIds = resolveWidgetDragShapeIds( editor, state.hitShapeId );
				const widgets = getWidgetsForShapeIds( editor, shapeIds );
				state.widgets = widgets;
				state.shapeSnapshots = getShapeSnapshots( editor, shapeIds );
				return widgets;
			};

			const syncComposerDragTarget = ( pointerEvent: PointerEvent ) => {
				const widgets = resolveDragWidgets();
				if ( widgets.length === 0 ) {
					cleanup();
					return;
				}

				const isComposerDragTarget = isChatDropTargetAtPoint(
					pointerEvent.clientX,
					pointerEvent.clientY
				);
				setComposerWidgetDragPreview(
					isComposerDragTarget
						? {
								widgets,
								x: pointerEvent.clientX,
								y: pointerEvent.clientY,
						  }
						: undefined
				);
				if ( isComposerDragTargetRef.current !== isComposerDragTarget ) {
					isComposerDragTargetRef.current = isComposerDragTarget;
					setComposerWidgetDragTarget( isComposerDragTarget );
				}
			};

			const handlePointerMove = ( pointerEvent: PointerEvent ) => {
				if ( pointerEvent.pointerId !== state.pointerId ) {
					return;
				}

				if ( ! state.didMove ) {
					const distance = Math.hypot(
						pointerEvent.clientX - state.startX,
						pointerEvent.clientY - state.startY
					);
					if ( distance < WIDGET_DRAG_THRESHOLD ) {
						return;
					}
					state.didMove = true;
				}

				syncComposerDragTarget( pointerEvent );
			};

			const handlePointerUp = ( pointerEvent: PointerEvent ) => {
				if ( pointerEvent.pointerId !== state.pointerId ) {
					return;
				}

				if (
					state.didMove &&
					isChatDropTargetAtPoint( pointerEvent.clientX, pointerEvent.clientY )
				) {
					const widgets = resolveDragWidgets();
					if ( widgets.length > 0 ) {
						attachWidgetsToComposer( widgets );
						if ( ! isReadOnly && state.shapeSnapshots?.length ) {
							requestAnimationFrame( () => {
								restoreShapeSnapshots( editor, state.shapeSnapshots ?? [] );
							} );
						}
						pointerEvent.preventDefault();
					}
				}

				cleanup();
			};

			const handlePointerCancel = ( pointerEvent: PointerEvent ) => {
				if ( pointerEvent.pointerId === state.pointerId ) {
					cleanup();
				}
			};

			window.addEventListener( 'pointermove', handlePointerMove, true );
			window.addEventListener( 'pointerup', handlePointerUp, true );
			window.addEventListener( 'pointercancel', handlePointerCancel, true );
			stopTrackingWidgetDragRef.current = cleanup;
		},
		[
			attachWidgetsToComposer,
			editor,
			isReadOnly,
			setComposerWidgetDragPreview,
			setComposerWidgetDragTarget,
		]
	);

	if ( isLoading ) {
		return <div className={ styles.loading } />;
	}

	return (
		<div
			className={ styles.canvas }
			onContextMenu={ handleContextMenu }
			onPointerDownCapture={ handlePointerDown }
		>
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

const WIDGET_DRAG_THRESHOLD = 8;

interface CanvasWidgetDragState {
	pointerId: number;
	startX: number;
	startY: number;
	hitShapeId: TLShape[ 'id' ];
	didMove: boolean;
	widgets: DeskWidget[] | null;
	shapeSnapshots: CanvasWidgetDragShapeSnapshot[] | null;
}

type CanvasWidgetDragShapeSnapshot = Pick<
	TLShape,
	'id' | 'type' | 'x' | 'y' | 'rotation' | 'index' | 'meta'
>;

function shouldIgnoreWidgetDragSource( target: HTMLElement ) {
	return Boolean(
		target.closest(
			[
				'[data-ui-desks-context-menu]',
				'input',
				'textarea',
				'select',
				'button',
				'a',
				'[contenteditable="true"]',
			].join( ',' )
		)
	);
}

function getShapeAtScreenPoint( editor: Editor, x: number, y: number ) {
	return editor.getShapeAtPoint( editor.screenToPage( { x, y } ), {
		hitInside: true,
		renderingOnly: true,
		margin: editor.options.hitTestMargin / editor.getZoomLevel(),
	} ) as TLShape | undefined;
}

function resolveWidgetDragShapeIds( editor: Editor, hitShapeId: TLShape[ 'id' ] ) {
	const selectedShapeIds = editor.getSelectedShapeIds();
	return selectedShapeIds.includes( hitShapeId ) ? selectedShapeIds : [ hitShapeId ];
}

function getWidgetsForShapeIds( editor: Editor, shapeIds: TLShape[ 'id' ][] ) {
	return shapeIds
		.map( ( shapeId ) => editor.getShape( shapeId ) )
		.map( ( shape ) => ( shape ? canvasShapeToDeskWidget( shape ) : null ) )
		.filter( ( widget ): widget is DeskWidget => widget !== null );
}

function getShapeSnapshots( editor: Editor, shapeIds: TLShape[ 'id' ][] ) {
	return shapeIds
		.map( ( shapeId ) => editor.getShape( shapeId ) )
		.filter( ( shape ): shape is TLShape => Boolean( shape ) )
		.map( ( shape ) => ( {
			id: shape.id,
			type: shape.type,
			x: shape.x,
			y: shape.y,
			rotation: shape.rotation,
			index: shape.index,
			meta: shape.meta,
		} ) );
}

function restoreShapeSnapshots( editor: Editor, snapshots: CanvasWidgetDragShapeSnapshot[] ) {
	if ( editor.isDisposed ) {
		return;
	}

	const existingSnapshots = snapshots.filter( ( snapshot ) => editor.getShape( snapshot.id ) );
	if ( existingSnapshots.length === 0 ) {
		return;
	}

	editor.updateShapes( existingSnapshots );
}

function isChatDropTargetAtPoint( x: number, y: number ) {
	const element = document.elementFromPoint( x, y );
	return Boolean( element?.closest( '[data-ui-desks-chat-dropzone]' ) );
}
