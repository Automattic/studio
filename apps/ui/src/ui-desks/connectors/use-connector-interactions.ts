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
	isShapePartOfMultiSelection,
} from './utils';
import type {
	ActiveWidgetDropFeedback,
	DeskWidget,
	WidgetCustomDropActionIntent,
	WidgetDropFeedback,
	WidgetDropFeedbackPhase,
	WidgetDropHandler,
} from '@/ui-desks/widgets/types';
import type { Editor, TLArrowShape, TLEventInfo, TLShape, TLShapeId } from 'tldraw';

interface UseConnectorInteractionsOptions {
	editor: Editor | null;
	isHydrated: boolean;
	isReadOnly: boolean;
	pendingConnectorSourceId: TLShapeId | null;
	setPendingConnectorSourceId: ( shapeId: TLShapeId | null ) => void;
	onConnectorComplete?: ( connection: WidgetConnectorCompleteIntent ) => void;
	onCustomDrop?: ( drop: WidgetCustomDropIntent ) => void;
	onDropFeedbackChange?: ( feedback: ActiveWidgetDropFeedback | null ) => void;
}

export function useConnectorInteractions( {
	editor,
	isHydrated,
	isReadOnly,
	pendingConnectorSourceId,
	setPendingConnectorSourceId,
	onConnectorComplete,
	onCustomDrop,
	onDropFeedbackChange,
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
		const sourceWidget = sourceShape ? canvasShapeToDeskWidget( sourceShape ) : null;
		if ( ! sourceShape || ! sourceWidget ) {
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
			const targetWidget = targetShape ? canvasShapeToDeskWidget( targetShape ) : null;
			if ( ! targetShape || ! targetWidget ) {
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
			onConnectorComplete?.( {
				sourceShapeId: pendingConnectorSourceId,
				targetShapeId: targetShape.id,
				sourceWidget,
				targetWidget,
			} );
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
	}, [ editor, onConnectorComplete, pendingConnectorSourceId, setPendingConnectorSourceId ] );

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
			opacity: number;
		} | null = null;
		let connectorPreviewId: TLArrowShape[ 'id' ] | null = null;
		let activeTarget: WidgetDropTarget | null = null;
		let activeDropFeedbackKey: string | null = null;
		let hasSourceOpacityOverride = false;
		let didDrag = false;
		let completed = false;

		const getCustomDropFeedback = (
			target: WidgetDropTarget | null,
			phase: WidgetDropFeedbackPhase
		): WidgetDropFeedback | null => {
			if ( ! source || ! target || target.handler.type !== 'custom' ) {
				return null;
			}

			return (
				target.handler.getFeedback?.( {
					sourceShapeId: source.shapeId,
					targetShapeId: target.shapeId,
					sourceWidget: source.widget,
					targetWidget: target.widget,
					screenPoint: getViewportScreenPoint( editor ),
					phase,
				} ) ?? null
			);
		};

		const toActiveDropFeedback = (
			target: WidgetDropTarget | null,
			feedback: WidgetDropFeedback | null,
			phase: WidgetDropFeedbackPhase
		): ActiveWidgetDropFeedback | null => {
			if ( ! target || ! feedback?.target ) {
				return null;
			}

			return {
				targetShapeId: target.shapeId,
				feedback: {
					...feedback.target,
					phase,
				},
			};
		};

		const syncDropFeedback = (
			target: WidgetDropTarget | null,
			phase: WidgetDropFeedbackPhase
		) => {
			const feedback = getCustomDropFeedback( target, phase );
			const activeFeedback = toActiveDropFeedback( target, feedback, phase );
			const nextKey = activeFeedback
				? `${ activeFeedback.targetShapeId }:${ activeFeedback.feedback.kind }:${ phase }`
				: null;
			if ( activeDropFeedbackKey !== nextKey ) {
				activeDropFeedbackKey = nextKey;
				onDropFeedbackChange?.( activeFeedback );
			}
			return feedback;
		};

		const setSourceOpacity = ( opacity: number ) => {
			if ( ! source ) {
				return;
			}

			const shape = editor.getShape( source.shapeId );
			if ( ! shape || Math.abs( shape.opacity - opacity ) <= 0.001 ) {
				return;
			}

			editor.updateShape( {
				id: source.shapeId,
				type: source.type as TLShape[ 'type' ],
				opacity,
			} );
			hasSourceOpacityOverride = true;
		};

		const restoreSourceOpacity = () => {
			if ( ! source || ! hasSourceOpacityOverride ) {
				return;
			}

			const shape = editor.getShape( source.shapeId );
			if ( shape && Math.abs( shape.opacity - source.opacity ) > 0.001 ) {
				editor.updateShape( {
					id: source.shapeId,
					type: source.type as TLShape[ 'type' ],
					opacity: source.opacity,
				} );
			}
			hasSourceOpacityOverride = false;
		};

		const removeConnectorPreview = ( options: { preserveSourceOpacity?: boolean } = {} ) => {
			if ( connectorPreviewId && editor.getShape( connectorPreviewId ) ) {
				editor.deleteShape( connectorPreviewId );
			}
			connectorPreviewId = null;
			activeTarget = null;
			syncDropFeedback( null, 'hover' );
			if ( ! options.preserveSourceOpacity ) {
				restoreSourceOpacity();
			}
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

		const cleanup = ( options: { preserveSourceOpacity?: boolean } = {} ) => {
			if ( ! completed ) {
				removeConnectorPreview( options );
			}
			if ( ! options.preserveSourceOpacity ) {
				restoreSourceOpacity();
			}
			source = null;
			connectorPreviewId = null;
			activeTarget = null;
			activeDropFeedbackKey = null;
			hasSourceOpacityOverride = false;
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
					widget && shape && ! isShapePartOfMultiSelection( editor, shape.id )
						? {
								shapeId: shape.id,
								widget,
								type: shape.type,
								x: shape.x,
								y: shape.y,
								opacity: shape.opacity,
						  }
						: null;
				connectorPreviewId = null;
				activeTarget = null;
				syncDropFeedback( null, 'hover' );
				hasSourceOpacityOverride = false;
				didDrag = false;
				completed = false;
				return;
			}

			if ( ! source ) {
				return;
			}

			if ( isShapePartOfMultiSelection( editor, source.shapeId ) ) {
				cleanup();
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
						onConnectorComplete?.( {
							sourceShapeId: source.shapeId,
							targetShapeId: activeTarget.shapeId,
							sourceWidget: source.widget,
							targetWidget: activeTarget.widget,
						} );
					} else if ( activeTarget.handler.type === 'custom' ) {
						const menuFeedback = getCustomDropFeedback( activeTarget, 'menu' );
						const activeMenuFeedback = toActiveDropFeedback( activeTarget, menuFeedback, 'menu' );
						const customDrop: WidgetCustomDropIntent = {
							sourceShapeId: source.shapeId,
							targetShapeId: activeTarget.shapeId,
							sourceWidget: source.widget,
							targetWidget: activeTarget.widget,
							handler: activeTarget.handler,
							screenPoint: getViewportScreenPoint( editor ),
							sourceOpacity: source.opacity,
						};
						restoreSourcePosition();
						if ( typeof menuFeedback?.sourceOpacity === 'number' ) {
							setSourceOpacity( menuFeedback.sourceOpacity );
						} else {
							restoreSourceOpacity();
						}
						cleanup( { preserveSourceOpacity: typeof menuFeedback?.sourceOpacity === 'number' } );
						onDropFeedbackChange?.( activeMenuFeedback );
						onCustomDrop?.( customDrop );
						return;
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
				const customTarget = {
					shapeId: target.shape.id,
					widget: target.widget,
					handler: target.handler,
				};
				const feedback = syncDropFeedback( customTarget, 'hover' );
				if ( connectorPreviewId ) {
					removeConnectorPreview();
					activeTarget = customTarget;
					syncDropFeedback( activeTarget, 'hover' );
				}
				if ( typeof feedback?.sourceOpacity === 'number' ) {
					setSourceOpacity( feedback.sourceOpacity );
				} else {
					restoreSourceOpacity();
				}
				return;
			}

			syncDropFeedback( null, 'hover' );
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
	}, [ editor, isHydrated, isReadOnly, onConnectorComplete, onCustomDrop, onDropFeedbackChange ] );
}

export interface WidgetConnectorCompleteIntent {
	sourceShapeId: TLShapeId;
	targetShapeId: TLShapeId;
	sourceWidget: DeskWidget;
	targetWidget: DeskWidget;
}

export interface WidgetCustomDropIntent extends WidgetCustomDropActionIntent {
	handler: Extract< WidgetDropHandler, { type: 'custom' } >;
	sourceOpacity: number;
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
