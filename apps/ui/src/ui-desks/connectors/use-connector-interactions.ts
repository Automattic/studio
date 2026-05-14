import { useEffect } from 'react';
import {
	canvasShapeToDeskWidget,
	isDeskConnectorCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import {
	completeConnectorPreview,
	createConnectorPreview,
	getInitialConnectorEndPoint,
	toPlainPoint,
	updateConnectorEnd,
} from './editor-commands';
import {
	getConnectableShapeAtPagePoint,
	getWidgetDropTargetAtPagePoint,
	getWidgetShapeAtPagePoint,
} from './utils';
import type { DeskWidget, WidgetDropHandler } from '@/ui-desks/widgets/types';
import type { Editor, TLArrowShape, TLEventInfo, TLShape, TLShapeId } from 'tldraw';

interface UseConnectorInteractionsOptions {
	editor: Editor | null;
	isHydrated: boolean;
	isReadOnly: boolean;
	pendingConnectorSourceId: TLShapeId | null;
	setPendingConnectorSourceId: ( shapeId: TLShapeId | null ) => void;
	onCustomDrop?: ( drop: WidgetCustomDropIntent ) => void;
}

export function useConnectorInteractions( {
	editor,
	isHydrated,
	isReadOnly,
	pendingConnectorSourceId,
	setPendingConnectorSourceId,
	onCustomDrop,
}: UseConnectorInteractionsOptions ) {
	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		return editor.sideEffects.registerBeforeChangeHandler(
			'shape',
			( previousShape, nextShape ) => {
				if ( ! isDeskConnectorCanvasShape( nextShape ) ) {
					return nextShape;
				}
				if ( previousShape.x === nextShape.x && previousShape.y === nextShape.y ) {
					return nextShape;
				}
				return {
					...nextShape,
					x: previousShape.x,
					y: previousShape.y,
				};
			}
		);
	}, [ editor ] );

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		return editor.sideEffects.registerAfterDeleteHandler( 'binding', ( binding ) => {
			if ( binding.type !== 'arrow' ) {
				return;
			}

			const connectorShape = editor.getShape( binding.fromId );
			if ( ! isDeskConnectorCanvasShape( connectorShape ) ) {
				return;
			}

			editor.deleteShape( connectorShape.id );
		} );
	}, [ editor ] );

	useEffect( () => {
		if ( ! editor || ! isReadOnly ) {
			return;
		}

		return editor.store.listen(
			() => {
				const selectedShapeIds = editor.getSelectedShapeIds();
				if ( selectedShapeIds.length === 0 ) {
					return;
				}

				const nextSelectedShapeIds = selectedShapeIds.filter(
					( shapeId ) => ! isDeskConnectorCanvasShape( editor.getShape( shapeId ) )
				);
				if ( nextSelectedShapeIds.length !== selectedShapeIds.length ) {
					editor.setSelectedShapes( nextSelectedShapeIds );
				}
			},
			{ scope: 'session' }
		);
	}, [ editor, isReadOnly ] );

	useEffect( () => {
		if ( ! editor || ! pendingConnectorSourceId ) {
			return;
		}

		const sourceShape = editor.getShape( pendingConnectorSourceId );
		if ( ! sourceShape || ! canvasShapeToDeskWidget( sourceShape ) ) {
			setPendingConnectorSourceId( null );
			return;
		}

		const sourceBounds = editor.getShapePageBounds( pendingConnectorSourceId );
		const startPoint = toPlainPoint( sourceBounds?.center ?? editor.inputs.currentPagePoint );
		const initialEndPoint = getInitialConnectorEndPoint(
			startPoint,
			toPlainPoint( editor.inputs.currentPagePoint )
		);
		const arrowId = createConnectorPreview(
			editor,
			pendingConnectorSourceId,
			startPoint,
			initialEndPoint
		);

		let completed = false;
		const cancelConnection = () => {
			setPendingConnectorSourceId( null );
		};

		const syncConnectorEnd = ( point: { x: number; y: number } ) => {
			const hitShape = getConnectableShapeAtPagePoint( editor, point, pendingConnectorSourceId );
			const hitBounds = hitShape ? editor.getShapePageBounds( hitShape.id ) : null;
			updateConnectorEnd( editor, arrowId, toPlainPoint( hitBounds?.center ?? point ) );
		};

		const handleEvent = ( info: TLEventInfo ) => {
			if ( info.type !== 'pointer' || info.name !== 'pointer_move' ) {
				return;
			}

			syncConnectorEnd( toPlainPoint( editor.inputs.currentPagePoint ) );
		};

		const handlePointerMove = ( event: PointerEvent ) => {
			syncConnectorEnd(
				toPlainPoint( editor.screenToPage( { x: event.clientX, y: event.clientY } ) )
			);
		};

		const handleClick = ( event: MouseEvent ) => {
			const target = event.target as HTMLElement | null;
			if ( target?.closest( '[data-ui-desks-context-menu]' ) ) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			const point = editor.screenToPage( { x: event.clientX, y: event.clientY } );
			const targetShape = getConnectableShapeAtPagePoint( editor, point, pendingConnectorSourceId );
			if ( ! targetShape ) {
				cancelConnection();
				return;
			}

			completed = true;
			completeConnectorPreview( editor, arrowId, targetShape.id );
			const targetBounds = editor.getShapePageBounds( targetShape.id );
			if ( targetBounds ) {
				updateConnectorEnd( editor, arrowId, toPlainPoint( targetBounds.center ) );
			}
			editor.setSelectedShapes( [ arrowId ] );
			editor.focus();
			setPendingConnectorSourceId( null );
		};

		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' ) {
				cancelConnection();
			}
		};

		editor.on( 'event', handleEvent );
		window.addEventListener( 'pointermove', handlePointerMove, true );
		window.addEventListener( 'click', handleClick, true );
		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			editor.off( 'event', handleEvent );
			window.removeEventListener( 'pointermove', handlePointerMove, true );
			window.removeEventListener( 'click', handleClick, true );
			window.removeEventListener( 'keydown', handleKeyDown );
			if ( ! completed && editor.getShape( arrowId ) ) {
				editor.deleteShape( arrowId );
			}
		};
	}, [ editor, pendingConnectorSourceId, setPendingConnectorSourceId ] );

	useEffect( () => {
		if ( ! editor || ! isHydrated || isReadOnly ) {
			return;
		}

		let source: {
			shapeId: TLShapeId;
			widget: DeskWidget;
			type: string;
			x: number;
			y: number;
		} | null = null;
		let connectorPreviewId: TLArrowShape[ 'id' ] | null = null;
		let activeTarget: WidgetDropTarget | null = null;
		let didDrag = false;
		let completed = false;

		const removeConnectorPreview = () => {
			if ( connectorPreviewId && editor.getShape( connectorPreviewId ) ) {
				editor.deleteShape( connectorPreviewId );
			}
			connectorPreviewId = null;
			activeTarget = null;
		};

		const restoreSourcePosition = () => {
			if ( ! source ) {
				return;
			}

			const shape = editor.getShape( source.shapeId );
			if ( ! shape || ( shape.x === source.x && shape.y === source.y ) ) {
				return;
			}

			editor.updateShape( {
				id: source.shapeId,
				type: source.type as TLShape[ 'type' ],
				x: source.x,
				y: source.y,
			} );
		};

		const cleanup = () => {
			if ( ! completed ) {
				removeConnectorPreview();
			}
			source = null;
			connectorPreviewId = null;
			activeTarget = null;
			didDrag = false;
			completed = false;
		};

		const handleEvent = ( info: TLEventInfo ) => {
			if ( info.type !== 'pointer' ) {
				return;
			}

			if ( info.name === 'pointer_down' ) {
				const shape = getWidgetShapeAtPagePoint( editor, editor.inputs.currentPagePoint );
				const widget = shape ? canvasShapeToDeskWidget( shape ) : null;
				source =
					widget && shape
						? { shapeId: shape.id, widget, type: shape.type, x: shape.x, y: shape.y }
						: null;
				connectorPreviewId = null;
				activeTarget = null;
				didDrag = false;
				completed = false;
				return;
			}

			if ( ! source ) {
				return;
			}

			if ( info.name === 'pointer_up' ) {
				if ( didDrag && activeTarget ) {
					if ( activeTarget.handler.type === 'connector' && connectorPreviewId ) {
						completed = true;
						completeConnectorPreview( editor, connectorPreviewId, activeTarget.shapeId );
						const targetBounds = editor.getShapePageBounds( activeTarget.shapeId );
						if ( targetBounds ) {
							updateConnectorEnd( editor, connectorPreviewId, toPlainPoint( targetBounds.center ) );
						}
						restoreSourcePosition();
					} else if ( activeTarget.handler.type === 'custom' ) {
						restoreSourcePosition();
						onCustomDrop?.( {
							sourceShapeId: source.shapeId,
							targetShapeId: activeTarget.shapeId,
							sourceWidget: source.widget,
							targetWidget: activeTarget.widget,
							handler: activeTarget.handler,
							screenPoint: getViewportScreenPoint( editor ),
						} );
					}
				}
				cleanup();
				return;
			}

			if ( info.name !== 'pointer_move' || ! editor.inputs.isDragging ) {
				return;
			}

			didDrag = true;
			const point = toPlainPoint( editor.inputs.currentPagePoint );
			const target = getWidgetDropTargetAtPagePoint( editor, point, source.shapeId, source.widget );
			if ( ! target ) {
				removeConnectorPreview();
				return;
			}

			activeTarget = {
				shapeId: target.shape.id,
				widget: target.widget,
				handler: target.handler,
			};
			restoreSourcePosition();

			if ( target.handler.type !== 'connector' ) {
				if ( connectorPreviewId ) {
					removeConnectorPreview();
					activeTarget = {
						shapeId: target.shape.id,
						widget: target.widget,
						handler: target.handler,
					};
				}
				return;
			}

			const targetBounds = editor.getShapePageBounds( target.shape.id );
			if ( ! targetBounds ) {
				removeConnectorPreview();
				return;
			}

			if ( ! connectorPreviewId ) {
				const sourceBounds = editor.getShapePageBounds( source.shapeId );
				connectorPreviewId = createConnectorPreview(
					editor,
					source.shapeId,
					toPlainPoint( sourceBounds?.center ?? point ),
					toPlainPoint( targetBounds.center )
				);
			} else {
				updateConnectorEnd( editor, connectorPreviewId, toPlainPoint( targetBounds.center ) );
			}

			activeTarget = {
				shapeId: target.shape.id,
				widget: target.widget,
				handler: target.handler,
			};
		};

		editor.on( 'event', handleEvent );
		return () => {
			editor.off( 'event', handleEvent );
			cleanup();
		};
	}, [ editor, isHydrated, isReadOnly, onCustomDrop ] );
}

export interface WidgetCustomDropIntent {
	sourceShapeId: TLShapeId;
	targetShapeId: TLShapeId;
	sourceWidget: DeskWidget;
	targetWidget: DeskWidget;
	handler: Extract< WidgetDropHandler, { type: 'custom' } >;
	screenPoint: {
		x: number;
		y: number;
	};
}

interface WidgetDropTarget {
	shapeId: TLShapeId;
	widget: DeskWidget;
	handler: WidgetDropHandler;
}

function getViewportScreenPoint( editor: Editor ) {
	const screenPoint = editor.inputs.currentScreenPoint;
	const bounds = editor.getContainer().getBoundingClientRect();
	return {
		x: screenPoint.x + bounds.left,
		y: screenPoint.y + bounds.top,
	};
}
