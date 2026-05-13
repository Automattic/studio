import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	createShapeId,
	getIndexAbove,
	sortByIndex,
	type Editor,
	type TLArrowShape,
	type TLEventInfo,
	type TLShape,
	type TLShapeId,
	type TLShapePartial,
} from 'tldraw';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import {
	focusOnDeskShape,
	getOutgoingWidgetConnections,
	getSelectedDeskConnectorToolbarItem,
} from '@/ui-desks/desk/connections';
import {
	CONNECTOR_COLOR,
	CONNECTOR_DASH,
	CONNECTOR_DEFAULT_BEND,
	CONNECTOR_SHAPE_ID_PREFIX,
	canvasShapeToDeskWidget,
	getTemporaryDeskCanvasRecordMeta,
	deskWidgetToCanvasShape,
	isDeskConnectorCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { useStackInteractions } from '@/ui-desks/stacks/use-stack-interactions';
import { useStackPressAnimation } from '@/ui-desks/stacks/use-stack-press-animation';
import { createDeskWidget } from '@/ui-desks/widget-actions/create-widget';
import { getWidgetDropHandler } from '@/ui-desks/widget-actions/drop-handlers';
import { getWidgetEditAction } from '@/ui-desks/widget-actions/edit-action';
import { getWidgetFileHandler } from '@/ui-desks/widget-actions/file-handlers';
import {
	createUrlPastePayload,
	getWidgetPasteHandler,
} from '@/ui-desks/widget-actions/paste-handlers';
import { LOADING_WIDGET_TYPE } from '@/ui-desks/widgets/loading/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import {
	DeskContext,
	type AddDeskWidgetOptions,
	type DeskProviderProps,
	type SelectedWidgetToolbarItem,
} from './context';
import {
	addWidgetToEditor,
	convertDrawShapesToDrawingWidget,
	createWidgetId,
	createDeskConfigFromEditor,
	fitSelectedWidgetToContentInEditor,
	getCurrentSelectedWidgetToolbarItem,
	hasCameraChange,
	hasPersistentDocumentChange,
	hydrateEditorFromDesk,
	isDrawShape,
	removeSelectedWidgetFromEditor,
	setSelectedStackViewInEditor,
	stackSelectedWidgetsInEditor,
	unstackSelectedWidgetsInEditor,
	updateSelectedWidgetPropsInEditor,
} from './editor-state';
import { useDeskPersistence } from './persistence';
import { useDeskWidgetResolvers } from './resolvers';
import type {
	DeskWidget,
	WidgetDropHandler,
	WidgetHandlerLoading,
	WidgetHandlerResult,
	WidgetPastePayload,
} from '@/ui-desks/widgets/types';

export { useDesk, useRegisterDeskEditor } from './context';

export function DeskProvider( {
	siteId,
	children,
	deskConfig,
	deskConfigKey,
	initialViewportMode,
	isLoading: externalIsLoading,
	isReadOnly = false,
	statusMessage,
}: DeskProviderProps ) {
	const hasExternalDeskConfig = Boolean( deskConfig );
	const {
		desk: persistedDesk,
		isLoading: isLoadingPersistedDesk,
		saveDeskConfig,
	} = useDeskPersistence( siteId, {
		enabled: ! hasExternalDeskConfig,
	} );
	const desk = deskConfig ?? persistedDesk;
	const isLoading = externalIsLoading ?? isLoadingPersistedDesk;
	const connector = useConnector();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const isRunningSite = Boolean( siteId && site?.running );
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const [ isHydrated, setIsHydrated ] = useState( false );
	const [ selectedWidgetToolbarItem, setSelectedWidgetToolbarItem ] =
		useState< SelectedWidgetToolbarItem | null >( null );
	const [ selectedConnectorToolbarItem, setSelectedConnectorToolbarItem ] =
		useState< ReturnType< typeof getSelectedDeskConnectorToolbarItem > >( null );
	const [ selectedWidgetConnectionTargets, setSelectedWidgetConnectionTargets ] = useState<
		ReturnType< typeof getOutgoingWidgetConnections >
	>( [] );
	const [ pendingConnectorSourceId, setPendingConnectorSourceId ] = useState< TLShapeId | null >(
		null
	);
	const [ pressedStackId, setPressedStackId ] = useState< string | null >( null );
	const hydratedRef = useRef( false );
	const deskConfigKeyRef = useRef< string | undefined >( undefined );
	const creationOffsetRef = useRef( 0 );
	const drawingStartShapeIdsRef = useRef< Set< string > | null >( null );
	const saveTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	const { pressStack, clearPressedStack } = useStackPressAnimation( setPressedStackId );
	const toolbarStateOptions = useMemo(
		() => ( {
			canStack: ! isReadOnly,
			canUnstack: ! isReadOnly,
			canSetStackView: ! isReadOnly,
			canRemove: ! isReadOnly,
		} ),
		[ isReadOnly ]
	);
	const selectedWidgetEditAction = useMemo( () => {
		if ( selectedWidgetToolbarItem?.kind !== 'single-widget' ) {
			return null;
		}

		return getWidgetEditAction(
			selectedWidgetToolbarItem.definition,
			selectedWidgetToolbarItem.widget,
			{
				hasSiteId: Boolean( siteId ),
				hasRunningSite: isRunningSite,
			}
		);
	}, [ isRunningSite, selectedWidgetToolbarItem, siteId ] );

	useStackInteractions( editor );

	useEffect( () => {
		if ( deskConfigKeyRef.current === deskConfigKey ) {
			return;
		}

		deskConfigKeyRef.current = deskConfigKey;
		hydratedRef.current = false;
		setIsHydrated( false );
		setSelectedWidgetToolbarItem( null );
		setSelectedConnectorToolbarItem( null );
		setSelectedWidgetConnectionTargets( [] );
		setPendingConnectorSourceId( null );
		drawingStartShapeIdsRef.current = null;
	}, [ deskConfigKey ] );

	useEffect( () => {
		if ( ! editor || isLoading || hydratedRef.current ) {
			return;
		}

		hydratedRef.current = true;
		hydrateEditorFromDesk( editor, desk, { initialViewportMode } );
		setIsHydrated( true );
		setSelectedWidgetToolbarItem(
			getCurrentSelectedWidgetToolbarItem( editor, toolbarStateOptions )
		);
		setSelectedConnectorToolbarItem( getSelectedDeskConnectorToolbarItem( editor ) );
		setSelectedWidgetConnectionTargets( getCurrentSelectedWidgetConnectionTargets( editor ) );
	}, [ desk, editor, initialViewportMode, isLoading, toolbarStateOptions ] );

	useEffect( () => {
		if ( ! editor || ! isReadOnly ) {
			return;
		}

		const stopShapeChanges = editor.sideEffects.registerBeforeChangeHandler(
			'shape',
			( previousShape, nextShape ) => {
				if ( ! editor.inputs.isDragging ) {
					return nextShape;
				}

				return previousShape;
			}
		);
		const stopConnectorSelection = editor.store.listen(
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

		return () => {
			stopShapeChanges();
			stopConnectorSelection();
		};
	}, [ editor, isReadOnly ] );

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		const queueSave = () => {
			if ( isReadOnly || ! hydratedRef.current ) {
				return;
			}

			if ( saveTimerRef.current ) {
				clearTimeout( saveTimerRef.current );
			}

			saveTimerRef.current = setTimeout( () => {
				saveTimerRef.current = null;
				saveDeskConfig( createDeskConfigFromEditor( editor ) );
			}, 500 );
		};
		const syncSelectedWidgetToolbarItem = () => {
			setSelectedWidgetToolbarItem(
				getCurrentSelectedWidgetToolbarItem( editor, toolbarStateOptions )
			);
			setSelectedConnectorToolbarItem( getSelectedDeskConnectorToolbarItem( editor ) );
			setSelectedWidgetConnectionTargets( getCurrentSelectedWidgetConnectionTargets( editor ) );
		};

		const unsubscribeDocument = editor.store.listen(
			( { changes } ) => {
				if ( hasPersistentDocumentChange( changes ) ) {
					queueSave();
				}
				syncSelectedWidgetToolbarItem();
			},
			{ scope: 'document' }
		);
		const unsubscribeSession = editor.store.listen(
			( { changes } ) => {
				if ( hasCameraChange( changes ) ) {
					queueSave();
				}
				syncSelectedWidgetToolbarItem();
			},
			{ scope: 'session' }
		);

		return () => {
			if ( saveTimerRef.current ) {
				clearTimeout( saveTimerRef.current );
				saveTimerRef.current = null;
			}
			unsubscribeDocument();
			unsubscribeSession();
		};
	}, [ editor, isReadOnly, saveDeskConfig, toolbarStateOptions ] );

	useEffect( () => {
		if ( ! editor || ! isHydrated || isReadOnly ) {
			return;
		}

		editor.registerExternalContentHandler( 'files', async ( { files, point } ) => {
			const handledFiles = files
				.map( ( file ) => ( {
					file,
					match: getWidgetFileHandler( file, { isRunningSite } ),
				} ) )
				.filter( ( item ): item is HandledDroppedFile => item.match !== null );

			if ( handledFiles.length === 0 ) {
				return;
			}

			const dropPoint = point ?? editor.getViewportPageBounds().center;
			let cursorX = dropPoint.x;
			const cursorY = dropPoint.y;
			const fileHandlers: Array< () => Promise< unknown > > = [];

			for ( const { file, match } of handledFiles ) {
				if ( editor.isDisposed ) {
					return;
				}

				const placeholder = createTemporaryLoadingWidget( editor, {
					center: {
						x: cursorX,
						y: cursorY,
					},
					loading: match.handler.loading,
				} );
				if ( ! placeholder ) {
					continue;
				}

				cursorX += placeholder.size.w + 20;
				fileHandlers.push( () =>
					handleDroppedFile( {
						editor,
						file,
						getFilePath: ( nextFile ) => connector.getFilePath( nextFile ),
						match,
						placeholder,
						siteId,
					} )
				);
			}

			await Promise.all( fileHandlers.map( ( handleFile ) => handleFile() ) );
		} );

		return () => {
			editor.registerExternalContentHandler( 'files', null );
		};
	}, [ connector, editor, isHydrated, isReadOnly, isRunningSite, siteId ] );

	useEffect( () => {
		if ( ! editor || ! isHydrated || isReadOnly ) {
			return;
		}

		editor.registerExternalContentHandler( 'url', async ( { url, point } ) => {
			const payload = createUrlPastePayload( url );
			if ( ! payload ) {
				return;
			}

			const match = getWidgetPasteHandler( payload, { isRunningSite, siteId } );
			if ( ! match ) {
				return;
			}

			await handlePastedContent( {
				editor,
				payload,
				match,
				center: point ?? editor.getViewportPageBounds().center,
				siteId,
			} );
		} );

		const handlePaste = ( event: ClipboardEvent ) => {
			if ( shouldIgnorePasteEvent( event ) ) {
				return;
			}

			const payload = createUrlPastePayload( event.clipboardData?.getData( 'text/plain' ) ?? '' );
			if ( ! payload || ! getWidgetPasteHandler( payload, { isRunningSite, siteId } ) ) {
				return;
			}

			event.preventDefault();
			void editor.putExternalContent( {
				type: 'url',
				url: payload.url,
				point: editor.getViewportPageBounds().center,
			} );
		};

		window.addEventListener( 'paste', handlePaste );

		return () => {
			window.removeEventListener( 'paste', handlePaste );
			editor.registerExternalContentHandler( 'url', null );
		};
	}, [ editor, isHydrated, isReadOnly, isRunningSite, siteId ] );

	useEffect( () => {
		if ( ! editor || ! isHydrated || isReadOnly ) {
			return;
		}

		return editor.sideEffects.registerAfterCreateHandler( 'shape', ( shape, source ) => {
			if ( source !== 'user' || shape.type !== 'text' ) {
				return;
			}

			queueMicrotask( () => {
				replaceTextShapeWithNote( editor, shape );
			} );
		} );
	}, [ editor, isHydrated, isReadOnly ] );

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
	}, [ editor, pendingConnectorSourceId ] );

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
		let activeTargetId: TLShapeId | null = null;
		let didDrag = false;
		let completed = false;

		const removeConnectorPreview = () => {
			if ( connectorPreviewId && editor.getShape( connectorPreviewId ) ) {
				editor.deleteShape( connectorPreviewId );
			}
			connectorPreviewId = null;
			activeTargetId = null;
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
			activeTargetId = null;
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
				activeTargetId = null;
				didDrag = false;
				completed = false;
				return;
			}

			if ( ! source ) {
				return;
			}

			if ( info.name === 'pointer_cancel' ) {
				cleanup();
				return;
			}

			if ( info.name === 'pointer_up' ) {
				if ( didDrag && connectorPreviewId && activeTargetId ) {
					completed = true;
					completeConnectorPreview( editor, connectorPreviewId, activeTargetId );
					const targetBounds = editor.getShapePageBounds( activeTargetId );
					if ( targetBounds ) {
						updateConnectorEnd( editor, connectorPreviewId, toPlainPoint( targetBounds.center ) );
					}
					restoreSourcePosition();
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
			if ( ! target || target.handler.type !== 'connector' ) {
				removeConnectorPreview();
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

			activeTargetId = target.shape.id;
			restoreSourcePosition();
		};

		editor.on( 'event', handleEvent );
		return () => {
			editor.off( 'event', handleEvent );
			cleanup();
		};
	}, [ editor, isHydrated, isReadOnly ] );

	const registerEditor = useCallback(
		( nextEditor: Editor | null ) => {
			setEditor( nextEditor );
			if ( ! nextEditor ) {
				hydratedRef.current = false;
				setIsHydrated( false );
				setSelectedWidgetToolbarItem( null );
				setSelectedConnectorToolbarItem( null );
				setSelectedWidgetConnectionTargets( [] );
				setPendingConnectorSourceId( null );
				clearPressedStack();
				drawingStartShapeIdsRef.current = null;
			}
		},
		[ clearPressedStack ]
	);

	const addWidget = useCallback(
		( type: string, options?: AddDeskWidgetOptions ) => {
			if ( isReadOnly || ! editor || ! isHydrated ) {
				return false;
			}

			const didAddWidget = addWidgetToEditor( editor, type, creationOffsetRef.current, options );
			if ( didAddWidget ) {
				creationOffsetRef.current += 1;
			}
			return didAddWidget;
		},
		[ editor, isHydrated, isReadOnly ]
	);

	const addWidgetAtScreenPoint = useCallback(
		(
			type: string,
			point: { x: number; y: number },
			options?: Omit< AddDeskWidgetOptions, 'center' >
		) => {
			if ( isReadOnly || ! editor || ! isHydrated ) {
				return false;
			}

			return addWidgetToEditor( editor, type, 0, {
				...options,
				center: editor.screenToPage( point ),
			} );
		},
		[ editor, isHydrated, isReadOnly ]
	);

	const addPastedContent = useCallback(
		async ( payload: WidgetPastePayload, options?: AddDeskWidgetOptions ) => {
			if ( isReadOnly || ! editor || ! isHydrated ) {
				return false;
			}

			const match = getWidgetPasteHandler( payload, { isRunningSite, siteId } );
			if ( ! match ) {
				return false;
			}

			const viewportCenter = editor.getViewportPageBounds().center;
			const offset = ( creationOffsetRef.current % 6 ) * 24;
			const center = options?.center ?? {
				x: viewportCenter.x + offset,
				y: viewportCenter.y + offset,
			};
			const didAddWidget = await handlePastedContent( {
				editor,
				payload,
				match,
				center,
				siteId,
			} );
			if ( didAddWidget ) {
				creationOffsetRef.current += 1;
			}
			return didAddWidget;
		},
		[ editor, isHydrated, isReadOnly, isRunningSite, siteId ]
	);

	const startDrawing = useCallback( () => {
		if ( isReadOnly || ! editor || ! isHydrated ) {
			return false;
		}

		drawingStartShapeIdsRef.current = new Set(
			editor.getCurrentPageShapes().map( ( shape ) => shape.id )
		);
		editor.setCurrentTool( 'draw' );
		editor.focus();
		return true;
	}, [ editor, isHydrated, isReadOnly ] );

	const finishDrawing = useCallback( async () => {
		if ( isReadOnly || ! editor || ! isHydrated ) {
			return false;
		}

		const startingShapeIds = drawingStartShapeIdsRef.current ?? new Set< string >();
		const drawShapes = editor
			.getCurrentPageShapes()
			.filter( isDrawShape )
			.filter( ( shape ) => ! startingShapeIds.has( shape.id ) );

		drawingStartShapeIdsRef.current = null;
		editor.setCurrentTool( 'select' );

		if ( drawShapes.length === 0 ) {
			editor.focus();
			return true;
		}

		const didConvertDrawing = await convertDrawShapesToDrawingWidget( editor, drawShapes );
		editor.focus();
		return didConvertDrawing;
	}, [ editor, isHydrated, isReadOnly ] );

	const updateSelectedWidgetProps = useCallback(
		( widgetProps: Record< string, unknown > ) => {
			if ( isReadOnly || ! editor || ! isHydrated ) {
				return false;
			}

			const nextSelectedWidgetToolbarItem = updateSelectedWidgetPropsInEditor(
				editor,
				widgetProps
			);
			if ( ! nextSelectedWidgetToolbarItem ) {
				return false;
			}

			setSelectedWidgetToolbarItem( nextSelectedWidgetToolbarItem );
			return true;
		},
		[ editor, isHydrated, isReadOnly ]
	);

	const editSelectedWidget = useCallback( () => {
		if ( ! editor || ! selectedWidgetEditAction ) {
			return false;
		}

		if ( selectedWidgetEditAction.kind === 'canvas-editing' ) {
			const [ selectedShapeId ] = editor.getSelectedShapeIds();
			if ( ! selectedShapeId ) {
				return false;
			}

			editor.setEditingShape( selectedShapeId );
			editor.focus();
			return true;
		}

		if ( ! siteId ) {
			return false;
		}

		void connector.openSiteUrl( siteId, selectedWidgetEditAction.path );
		return true;
	}, [ connector, editor, selectedWidgetEditAction, siteId ] );

	const fitSelectedWidgetToContent = useCallback( async () => {
		if (
			isReadOnly ||
			! editor ||
			! isHydrated ||
			! ( await fitSelectedWidgetToContentInEditor( editor ) )
		) {
			return false;
		}

		setSelectedWidgetToolbarItem(
			getCurrentSelectedWidgetToolbarItem( editor, toolbarStateOptions )
		);
		return true;
	}, [ editor, isHydrated, isReadOnly, toolbarStateOptions ] );

	const stackSelectedWidgets = useCallback( () => {
		if ( isReadOnly || ! editor || ! isHydrated || ! stackSelectedWidgetsInEditor( editor ) ) {
			return false;
		}

		setSelectedWidgetToolbarItem(
			getCurrentSelectedWidgetToolbarItem( editor, toolbarStateOptions )
		);
		return true;
	}, [ editor, isHydrated, isReadOnly, toolbarStateOptions ] );

	const unstackSelectedWidgets = useCallback( () => {
		if ( isReadOnly || ! editor || ! isHydrated || ! unstackSelectedWidgetsInEditor( editor ) ) {
			return false;
		}

		setSelectedWidgetToolbarItem(
			getCurrentSelectedWidgetToolbarItem( editor, toolbarStateOptions )
		);
		return true;
	}, [ editor, isHydrated, isReadOnly, toolbarStateOptions ] );

	const setSelectedStackView = useCallback(
		( viewMode: Parameters< typeof setSelectedStackViewInEditor >[ 1 ] ) => {
			if (
				isReadOnly ||
				! editor ||
				! isHydrated ||
				! setSelectedStackViewInEditor( editor, viewMode )
			) {
				return false;
			}

			setSelectedWidgetToolbarItem(
				getCurrentSelectedWidgetToolbarItem( editor, toolbarStateOptions )
			);
			return true;
		},
		[ editor, isHydrated, isReadOnly, toolbarStateOptions ]
	);

	const removeSelectedWidget = useCallback( () => {
		if ( isReadOnly || ! editor || ! isHydrated || ! removeSelectedWidgetFromEditor( editor ) ) {
			return false;
		}

		setSelectedWidgetToolbarItem( null );
		return true;
	}, [ editor, isHydrated, isReadOnly ] );

	const removeSelectedConnector = useCallback( () => {
		if ( isReadOnly || ! editor || ! isHydrated ) {
			return false;
		}

		const connector = getSelectedDeskConnectorToolbarItem( editor );
		if ( ! connector ) {
			return false;
		}

		editor.deleteShape( connector.shapeId );
		setSelectedConnectorToolbarItem( null );
		return true;
	}, [ editor, isHydrated, isReadOnly ] );

	const startConnectingWidget = useCallback(
		( shapeId: TLShapeId ) => {
			if ( isReadOnly || ! editor || ! isHydrated ) {
				return false;
			}

			const shape = editor.getShape( shapeId );
			if ( ! shape || ! canvasShapeToDeskWidget( shape ) ) {
				return false;
			}

			setPendingConnectorSourceId( shapeId );
			editor.focus();
			return true;
		},
		[ editor, isHydrated, isReadOnly ]
	);

	const focusConnectedWidget = useCallback(
		( shapeId: TLShapeId ) => {
			if ( ! editor || ! isHydrated ) {
				return false;
			}

			return focusOnDeskShape( editor, shapeId );
		},
		[ editor, isHydrated ]
	);

	const value = useMemo(
		() => ( {
			siteId,
			isLoading,
			isReadOnly,
			statusMessage,
			canAddWidgets: ! isReadOnly && Boolean( editor ) && isHydrated,
			selectedWidgetToolbarItem,
			selectedConnectorToolbarItem,
			selectedWidgetConnectionTargets,
			isConnectingWidget: pendingConnectorSourceId !== null,
			pressedStackId,
			registerEditor,
			pressStack,
			addWidget,
			addWidgetAtScreenPoint,
			addPastedContent,
			startDrawing,
			finishDrawing,
			updateSelectedWidgetProps,
			canEditSelectedWidget: Boolean( selectedWidgetEditAction ),
			editSelectedWidget,
			fitSelectedWidgetToContent,
			stackSelectedWidgets,
			unstackSelectedWidgets,
			setSelectedStackView,
			removeSelectedWidget,
			removeSelectedConnector,
			startConnectingWidget,
			focusConnectedWidget,
		} ),
		[
			addPastedContent,
			addWidget,
			addWidgetAtScreenPoint,
			editor,
			editSelectedWidget,
			fitSelectedWidgetToContent,
			finishDrawing,
			focusConnectedWidget,
			isHydrated,
			isReadOnly,
			isLoading,
			pendingConnectorSourceId,
			pressStack,
			pressedStackId,
			registerEditor,
			removeSelectedConnector,
			removeSelectedWidget,
			selectedConnectorToolbarItem,
			selectedWidgetConnectionTargets,
			selectedWidgetToolbarItem,
			selectedWidgetEditAction,
			setSelectedStackView,
			stackSelectedWidgets,
			startDrawing,
			startConnectingWidget,
			siteId,
			statusMessage,
			unstackSelectedWidgets,
			updateSelectedWidgetProps,
		]
	);

	useDeskWidgetResolvers( {
		editor,
		isEnabled: Boolean( siteId && isHydrated ),
	} );

	return <DeskContext.Provider value={ value }>{ children }</DeskContext.Provider>;
}

function createConnectorPreview(
	editor: Editor,
	sourceShapeId: TLShapeId,
	startPoint: { x: number; y: number },
	endPoint: { x: number; y: number }
) {
	const arrowId = createShapeId(
		`${ CONNECTOR_SHAPE_ID_PREFIX }${ createWidgetId() }`
	) as TLArrowShape[ 'id' ];
	editor.createShape< TLArrowShape >( {
		id: arrowId,
		type: 'arrow',
		meta: {
			studioDeskConnector: true,
		},
		props: {
			kind: 'arc',
			color: CONNECTOR_COLOR,
			dash: CONNECTOR_DASH,
			size: 'm',
			bend: CONNECTOR_DEFAULT_BEND,
			arrowheadStart: 'dot',
			arrowheadEnd: 'arrow',
			start: startPoint,
			end: endPoint,
		},
	} );
	editor.createBindings( [
		{
			type: 'arrow',
			fromId: arrowId,
			toId: sourceShapeId,
			props: {
				terminal: 'start' as const,
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isExact: false,
				isPrecise: false,
				snap: 'none' as const,
			},
		},
	] );
	return arrowId;
}

function completeConnectorPreview(
	editor: Editor,
	connectorShapeId: TLArrowShape[ 'id' ],
	targetShapeId: TLShapeId
) {
	editor.createBindings( [
		{
			type: 'arrow',
			fromId: connectorShapeId,
			toId: targetShapeId,
			props: {
				terminal: 'end' as const,
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isExact: false,
				isPrecise: false,
				snap: 'none' as const,
			},
		},
	] );
}

function updateConnectorEnd(
	editor: Editor,
	connectorShapeId: TLArrowShape[ 'id' ],
	endPoint: { x: number; y: number }
) {
	editor.updateShape< TLArrowShape >( {
		id: connectorShapeId,
		type: 'arrow',
		props: {
			end: endPoint,
		},
	} );
}

function getCurrentSelectedWidgetConnectionTargets( editor: Editor ) {
	const selectedShapeIds = editor.getSelectedShapeIds();
	if ( selectedShapeIds.length !== 1 ) {
		return [];
	}

	const [ selectedShapeId ] = selectedShapeIds;
	const selectedShape = editor.getShape( selectedShapeId );
	if ( ! selectedShape || ! canvasShapeToDeskWidget( selectedShape ) ) {
		return [];
	}

	return getOutgoingWidgetConnections( editor, selectedShapeId );
}

function getWidgetShapeAtPagePoint( editor: Editor, point: { x: number; y: number } ) {
	return editor.getShapeAtPoint( point, {
		hitInside: true,
		renderingOnly: true,
		margin: editor.options.hitTestMargin / editor.getZoomLevel(),
	} ) as TLShape | undefined;
}

function getWidgetDropTargetAtPagePoint(
	editor: Editor,
	point: { x: number; y: number },
	sourceShapeId: TLShapeId,
	sourceWidget: DeskWidget
): { shape: TLShape; widget: DeskWidget; handler: WidgetDropHandler } | null {
	const target = editor
		.getCurrentPageShapes()
		.filter( ( shape ) => shape.id !== sourceShapeId && ! isDeskConnectorCanvasShape( shape ) )
		.map( ( shape ) => {
			const bounds = editor.getShapePageBounds( shape.id );
			const widget = canvasShapeToDeskWidget( shape );
			const handler = widget ? getWidgetDropHandler( sourceWidget, widget ) : null;
			return bounds && widget && handler && isPointInBounds( point, bounds )
				? { shape, widget, handler }
				: null;
		} )
		.filter(
			( item ): item is { shape: TLShape; widget: DeskWidget; handler: WidgetDropHandler } =>
				item !== null
		)
		.sort( ( first, second ) => sortByIndex( second.shape, first.shape ) )[ 0 ];

	return target ?? null;
}

function getConnectableShapeAtPagePoint(
	editor: Editor,
	point: { x: number; y: number },
	sourceShapeId: TLShapeId
) {
	const shape = editor.getShapeAtPoint( point, {
		hitInside: true,
		renderingOnly: true,
		margin: editor.options.hitTestMargin / editor.getZoomLevel(),
	} ) as TLShape | undefined;

	if ( ! shape || shape.id === sourceShapeId || isDeskConnectorCanvasShape( shape ) ) {
		return null;
	}

	return canvasShapeToDeskWidget( shape ) ? shape : null;
}

function isPointInBounds(
	point: { x: number; y: number },
	bounds: { minX: number; minY: number; maxX: number; maxY: number }
) {
	return (
		point.x >= bounds.minX &&
		point.x <= bounds.maxX &&
		point.y >= bounds.minY &&
		point.y <= bounds.maxY
	);
}

function toPlainPoint( point: { x: number; y: number } ) {
	return {
		x: point.x,
		y: point.y,
	};
}

function getInitialConnectorEndPoint(
	startPoint: { x: number; y: number },
	cursorPoint: { x: number; y: number }
) {
	const distance = Math.hypot( cursorPoint.x - startPoint.x, cursorPoint.y - startPoint.y );
	if ( distance >= 8 ) {
		return cursorPoint;
	}

	return {
		x: startPoint.x + 96,
		y: startPoint.y,
	};
}

function replaceTextShapeWithNote( editor: Editor, shape: TLShape ) {
	if ( editor.isDisposed || ! editor.getShape( shape.id ) ) {
		return;
	}

	editor.deleteShape( shape.id );
	editor.setCurrentTool( 'select' );
	addWidgetToEditor( editor, NOTE_WIDGET_TYPE, 0, {
		center: {
			x: shape.x,
			y: shape.y,
		},
	} );
}

type HandledDroppedFile = {
	file: File;
	match: NonNullable< ReturnType< typeof getWidgetFileHandler > >;
};

interface TemporaryLoadingWidget {
	shapeId: RectangleWidgetShape[ 'id' ];
	size: {
		w: number;
		h: number;
	};
}

async function handleDroppedFile( {
	editor,
	file,
	getFilePath,
	match,
	placeholder,
	siteId,
}: {
	editor: Editor;
	file: File;
	getFilePath: ( file: File ) => Promise< string >;
	match: NonNullable< ReturnType< typeof getWidgetFileHandler > >;
	placeholder: TemporaryLoadingWidget;
	siteId?: string;
} ) {
	try {
		const result = await match.handler.handle( file, { getFilePath, siteId } );
		if ( editor.isDisposed ) {
			return false;
		}

		const center = getShapeCenter( editor, placeholder.shapeId );
		if ( ! center ) {
			return false;
		}

		deleteTemporaryWidget( editor, placeholder.shapeId );
		return addHandledWidgetsToEditor( editor, match.definition.type, result, center ) > 0;
	} catch ( error ) {
		console.warn( 'Failed to handle dropped file.', error );
		deleteTemporaryWidget( editor, placeholder.shapeId );
		return false;
	}
}

async function handlePastedContent( {
	editor,
	payload,
	match,
	center,
	siteId,
}: {
	editor: Editor;
	payload: WidgetPastePayload;
	match: NonNullable< ReturnType< typeof getWidgetPasteHandler > >;
	center: { x: number; y: number };
	siteId?: string;
} ) {
	const placeholder = match.handler.loading
		? createTemporaryLoadingWidget( editor, {
				center,
				loading: match.handler.loading,
		  } )
		: null;

	try {
		const result = await match.handler.handle( payload, { siteId } );
		if ( editor.isDisposed ) {
			return false;
		}

		const widgetCenter = placeholder ? getShapeCenter( editor, placeholder.shapeId ) : center;
		if ( ! widgetCenter ) {
			return false;
		}

		if ( placeholder ) {
			deleteTemporaryWidget( editor, placeholder.shapeId );
		}

		return addHandledWidgetsToEditor( editor, match.definition.type, result, widgetCenter ) > 0;
	} catch ( error ) {
		console.warn( 'Failed to handle pasted content.', error );
		if ( placeholder ) {
			deleteTemporaryWidget( editor, placeholder.shapeId );
		}
		return false;
	}
}

function addHandledWidgetsToEditor(
	editor: Editor,
	type: string,
	result: WidgetHandlerResult | null,
	center: { x: number; y: number }
) {
	let addedWidgetCount = 0;
	let cursorX = center.x;
	const widgets = normalizeWidgetHandlerResult( result );
	for ( const widget of widgets ) {
		const widgetId = widget.id ?? createWidgetId();
		const shapeId = createShapeId( widgetId ) as RectangleWidgetShape[ 'id' ];
		const didAddWidget = addWidgetToEditor( editor, type, 0, {
			id: widgetId,
			center: {
				x: cursorX,
				y: center.y,
			},
			shapeProps: widget.shapeProps,
			widgetProps: widget.widgetProps,
			shouldStartEditing: widget.shouldStartEditing,
		} );
		if ( didAddWidget ) {
			addedWidgetCount += 1;
			cursorX += getHandledWidgetSize( editor, shapeId ).w + 20;
		}
	}

	return addedWidgetCount;
}

function normalizeWidgetHandlerResult( result: WidgetHandlerResult | null ) {
	if ( ! result ) {
		return [];
	}

	return Array.isArray( result ) ? result : [ result ];
}

function createTemporaryLoadingWidget(
	editor: Editor,
	{
		center,
		loading,
	}: {
		center: { x: number; y: number };
		loading?: WidgetHandlerLoading;
	}
): TemporaryLoadingWidget | null {
	const widgetId = createWidgetId();
	const widget = createDeskWidget( {
		id: widgetId,
		type: LOADING_WIDGET_TYPE,
		center,
		zIndex: getNextZIndexFromEditor( editor ),
		shapeProps: loading?.shapeProps,
		widgetProps: {
			label: loading?.label ?? __( 'Loading' ),
		},
	} );

	if ( ! widget ) {
		return null;
	}

	const shape = deskWidgetToCanvasShape( widget ) as TLShapePartial< RectangleWidgetShape >;
	const shapeId = createShapeId( widgetId ) as RectangleWidgetShape[ 'id' ];
	editor.createShape< RectangleWidgetShape >( {
		...shape,
		id: shapeId,
		meta: getTemporaryDeskCanvasRecordMeta( shape, 'loading' ),
	} );

	return {
		shapeId,
		size: widget.shapeProps,
	};
}

function deleteTemporaryWidget( editor: Editor, shapeId: RectangleWidgetShape[ 'id' ] ) {
	if ( ! editor.isDisposed && editor.getShape( shapeId ) ) {
		editor.deleteShapes( [ shapeId ] );
	}
}

function getHandledWidgetSize( editor: Editor, shapeId: RectangleWidgetShape[ 'id' ] ) {
	const shape = editor.getShape( shapeId );
	if ( isRectangleWidgetShape( shape ) ) {
		return shape.props.shapeProps;
	}

	return { w: 320, h: 320 };
}

function getShapeCenter( editor: Editor, shapeId: RectangleWidgetShape[ 'id' ] ) {
	const shape = editor.getShape( shapeId );
	if ( isRectangleWidgetShape( shape ) ) {
		return {
			x: shape.x + shape.props.shapeProps.w / 2,
			y: shape.y + shape.props.shapeProps.h / 2,
		};
	}

	return null;
}

function shouldIgnorePasteEvent( event: ClipboardEvent ) {
	const target = event.target as HTMLElement | null;
	if ( ! target ) {
		return false;
	}

	return (
		target.tagName === 'INPUT' ||
		target.tagName === 'TEXTAREA' ||
		target.tagName === 'SELECT' ||
		target.isContentEditable
	);
}

function getNextZIndexFromEditor( editor: Editor ) {
	return getIndexAbove( [ ...editor.getCurrentPageShapes() ].sort( sortByIndex ).at( -1 )?.index );
}

function isRectangleWidgetShape( shape: unknown ): shape is RectangleWidgetShape {
	return (
		Boolean( shape ) &&
		typeof shape === 'object' &&
		( shape as { type?: unknown } ).type === RECTANGLE_WIDGET_SHAPE_TYPE
	);
}
