import { __, _n, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Box,
	createShapeId,
	getIndexAbove,
	sortByIndex,
	type Editor,
	type TLShape,
	type TLShapeId,
	type TLShapePartial,
} from 'tldraw';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import {
	focusConnectedWidgetInEditor,
	removeSelectedConnectorFromEditor,
	startConnectingWidgetInEditor,
} from '@/ui-desks/connectors/editor-commands';
import { useConnectorInteractions } from '@/ui-desks/connectors/use-connector-interactions';
import {
	getCurrentSelectedWidgetConnectionTargets,
	getOutgoingWidgetConnections,
	getSelectedDeskConnectorToolbarItem,
} from '@/ui-desks/connectors/utils';
import {
	getTemporaryDeskCanvasRecordMeta,
	deskWidgetToCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { useStackInteractions } from '@/ui-desks/stacks/use-stack-interactions';
import { useStackPressAnimation } from '@/ui-desks/stacks/use-stack-press-animation';
import { createDeskWidget } from '@/ui-desks/widget-actions/create-widget';
import { getWidgetEditAction } from '@/ui-desks/widget-actions/edit-action';
import { getWidgetFileHandler } from '@/ui-desks/widget-actions/file-handlers';
import {
	createUrlPastePayload,
	getWidgetPasteHandler,
} from '@/ui-desks/widget-actions/paste-handlers';
import { LOADING_WIDGET_TYPE } from '@/ui-desks/widgets/loading/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import {
	createAnnotationNote,
	deleteAnnotationNotes,
	getAnnotationNoteShapes,
	getAnnotationSubmission,
	getSelectedAnnotationNoteShapeId,
	isAnnotationConnectorShape,
} from '@/ui-desks/widgets/site-preview/annotation-notes';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
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
import type { AnnotationPayload } from '@/ui-desks/widgets/site-preview/annotation-inspector';
import type {
	WidgetHandlerLoading,
	WidgetHandlerResult,
	WidgetPastePayload,
} from '@/ui-desks/widgets/types';

export { useDesk, useRegisterDeskEditor } from './context';

const ANNOTATE_DIM_OPACITY = 0.08;

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
	const [ annotatingPreviewShapeId, setAnnotatingPreviewShapeId ] = useState< TLShapeId | null >(
		null
	);
	const [ pendingAnnotation, setPendingAnnotation ] = useState< {
		previewShapeId: TLShapeId;
		payload: AnnotationPayload;
	} | null >( null );
	const [ annotationCount, setAnnotationCount ] = useState( 0 );
	const [ selectedAnnotationNoteShapeId, setSelectedAnnotationNoteShapeId ] =
		useState< TLShapeId | null >( null );
	const [ pressedStackId, setPressedStackId ] = useState< string | null >( null );
	const hydratedRef = useRef( false );
	const deskConfigKeyRef = useRef< string | undefined >( undefined );
	const creationOffsetRef = useRef( 0 );
	const drawingStartShapeIdsRef = useRef< Set< string > | null >( null );
	const annotateRestoreCameraRef = useRef< { x: number; y: number; z: number } | null >( null );
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
	useConnectorInteractions( {
		editor,
		isHydrated,
		isReadOnly,
		pendingConnectorSourceId,
		setPendingConnectorSourceId,
	} );

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		return editor.sideEffects.registerBeforeChangeHandler(
			'shape',
			( previousShape, nextShape ) => {
				if ( ! isAnnotationConnectorShape( nextShape ) ) {
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
			if ( isAnnotationConnectorShape( connectorShape ) ) {
				editor.deleteShape( connectorShape.id );
			}
		} );
	}, [ editor ] );

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		return editor.sideEffects.registerAfterChangeHandler( 'shape', ( previousShape, nextShape ) => {
			if (
				! isSitePreviewShape( nextShape ) ||
				( previousShape.x === nextShape.x && previousShape.y === nextShape.y )
			) {
				return;
			}
			const deltaX = nextShape.x - previousShape.x;
			const deltaY = nextShape.y - previousShape.y;
			const annotationNotes = getAnnotationNoteShapes( editor, nextShape.id );
			if ( annotationNotes.length === 0 ) {
				return;
			}
			editor.updateShapes(
				annotationNotes.map( ( note ) => ( {
					id: note.id,
					type: note.type,
					x: note.x + deltaX,
					y: note.y + deltaY,
				} ) )
			);
		} );
	}, [ editor ] );

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
		setAnnotatingPreviewShapeId( null );
		setPendingAnnotation( null );
		setAnnotationCount( 0 );
		setSelectedAnnotationNoteShapeId( null );
		annotateRestoreCameraRef.current = null;
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
		return () => {
			stopShapeChanges();
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
		if ( ! editor || ! annotatingPreviewShapeId ) {
			setAnnotationCount( 0 );
			setSelectedAnnotationNoteShapeId( null );
			return;
		}

		const syncAnnotationState = () => {
			setAnnotationCount( getAnnotationNoteShapes( editor, annotatingPreviewShapeId ).length );
			setSelectedAnnotationNoteShapeId(
				getSelectedAnnotationNoteShapeId( editor, annotatingPreviewShapeId )
			);
		};

		syncAnnotationState();
		const unsubscribeDocument = editor.store.listen( syncAnnotationState, { scope: 'document' } );
		const unsubscribeSession = editor.store.listen( syncAnnotationState, { scope: 'session' } );

		return () => {
			unsubscribeDocument();
			unsubscribeSession();
		};
	}, [ annotatingPreviewShapeId, editor ] );

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
				setAnnotatingPreviewShapeId( null );
				setPendingAnnotation( null );
				setAnnotationCount( 0 );
				setSelectedAnnotationNoteShapeId( null );
				annotateRestoreCameraRef.current = null;
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

		if ( ! removeSelectedConnectorFromEditor( editor ) ) {
			return false;
		}

		setSelectedConnectorToolbarItem( null );
		return true;
	}, [ editor, isHydrated, isReadOnly ] );

	const startConnectingWidget = useCallback(
		( shapeId: TLShapeId ) => {
			if ( isReadOnly || ! editor || ! isHydrated ) {
				return false;
			}

			if ( ! startConnectingWidgetInEditor( editor, shapeId ) ) {
				return false;
			}

			setPendingConnectorSourceId( shapeId );
			return true;
		},
		[ editor, isHydrated, isReadOnly ]
	);

	const focusConnectedWidget = useCallback(
		( shapeId: TLShapeId ) => {
			if ( ! editor || ! isHydrated ) {
				return false;
			}

			return focusConnectedWidgetInEditor( editor, shapeId );
		},
		[ editor, isHydrated ]
	);

	const startAnnotatingPreview = useCallback(
		( shapeId: TLShapeId ) => {
			if ( isReadOnly || ! editor || ! isHydrated ) {
				return false;
			}
			const shape = editor.getShape( shapeId );
			if ( ! isSitePreviewShape( shape ) ) {
				return false;
			}
			const bounds = editor.getShapePageBounds( shapeId );
			if ( ! bounds ) {
				return false;
			}

			annotateRestoreCameraRef.current = { ...editor.getCamera() };
			const padX = 260;
			const padTop = 80;
			const padBottom = 200;
			const paddedBounds = new Box(
				bounds.minX - padX,
				bounds.minY - padTop,
				bounds.w + padX * 2,
				bounds.h + padTop + padBottom
			);
			editor.complete();
			editor.zoomToBounds( paddedBounds, { animation: { duration: 320 } } );
			editor.setSelectedShapes( [ shapeId ] );
			editor.setCameraOptions( { ...editor.getCameraOptions(), isLocked: true } );
			setPendingConnectorSourceId( null );
			setPendingAnnotation( null );
			setAnnotatingPreviewShapeId( shapeId );
			editor.focus();
			return true;
		},
		[ editor, isHydrated, isReadOnly ]
	);

	const stopAnnotatingPreview = useCallback( () => {
		if ( ! editor ) {
			return false;
		}
		const previewShapeId = annotatingPreviewShapeId;
		if ( previewShapeId ) {
			deleteAnnotationNotes( editor, previewShapeId );
		}
		editor.setCameraOptions( { ...editor.getCameraOptions(), isLocked: false } );
		const restoreCamera = annotateRestoreCameraRef.current;
		if ( restoreCamera ) {
			editor.setCamera( restoreCamera, { animation: { duration: 320 }, force: true } );
			annotateRestoreCameraRef.current = null;
		}
		setAnnotatingPreviewShapeId( null );
		setPendingAnnotation( null );
		setAnnotationCount( 0 );
		setSelectedAnnotationNoteShapeId( null );
		editor.focus();
		return true;
	}, [ annotatingPreviewShapeId, editor ] );

	const requestAnnotation = useCallback(
		( previewShapeId: TLShapeId, payload: AnnotationPayload ) => {
			setPendingAnnotation( { previewShapeId, payload } );
		},
		[]
	);

	const confirmPendingAnnotation = useCallback(
		( comment: string ) => {
			if ( isReadOnly || ! editor || ! pendingAnnotation ) {
				return false;
			}
			const previewShape = editor.getShape( pendingAnnotation.previewShapeId );
			if ( ! isSitePreviewShape( previewShape ) ) {
				return false;
			}
			const noteShapeId = createAnnotationNote(
				editor,
				previewShape,
				pendingAnnotation.payload,
				comment
			);
			setPendingAnnotation( null );
			return Boolean( noteShapeId );
		},
		[ editor, isReadOnly, pendingAnnotation ]
	);

	const cancelPendingAnnotation = useCallback( () => {
		setPendingAnnotation( null );
	}, [] );

	const removeSelectedAnnotation = useCallback( () => {
		if ( isReadOnly || ! editor || ! annotatingPreviewShapeId || ! selectedAnnotationNoteShapeId ) {
			return false;
		}
		deleteAnnotationNotes( editor, annotatingPreviewShapeId, [ selectedAnnotationNoteShapeId ] );
		editor.setSelectedShapes( [ annotatingPreviewShapeId ] );
		editor.focus();
		return true;
	}, [ annotatingPreviewShapeId, editor, isReadOnly, selectedAnnotationNoteShapeId ] );

	const collectAnnotationSubmission = useCallback( () => {
		if ( ! editor || ! annotatingPreviewShapeId ) {
			return null;
		}
		return getAnnotationSubmission( editor, annotatingPreviewShapeId );
	}, [ annotatingPreviewShapeId, editor ] );

	useEffect( () => {
		if ( annotatingPreviewShapeId === null || ! editor ) {
			return;
		}

		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key !== 'Escape' ) {
				return;
			}
			if ( pendingAnnotation ) {
				event.preventDefault();
				setPendingAnnotation( null );
				return;
			}
			const count = getAnnotationNoteShapes( editor, annotatingPreviewShapeId ).length;
			if ( count > 0 ) {
				event.preventDefault();
				const shouldDiscard = window.confirm(
					sprintf( _n( 'Discard %d annotation?', 'Discard %d annotations?', count ), count )
				);
				if ( ! shouldDiscard ) {
					return;
				}
			}
			event.preventDefault();
			stopAnnotatingPreview();
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ annotatingPreviewShapeId, editor, pendingAnnotation, stopAnnotatingPreview ] );

	useEffect( () => {
		const canvas = document.querySelector( '[data-ui-desks-canvas]' );
		if ( canvas ) {
			if ( annotatingPreviewShapeId ) {
				canvas.setAttribute( 'data-ui-desks-annotating', String( annotatingPreviewShapeId ) );
			} else {
				canvas.removeAttribute( 'data-ui-desks-annotating' );
			}
		}

		if ( ! editor || ! annotatingPreviewShapeId ) {
			return;
		}

		const originals = new Map< TLShapeId, { type: string; opacity: number; isLocked: boolean } >();
		for ( const shape of editor.getCurrentPageShapes() ) {
			originals.set( shape.id, {
				type: shape.type,
				opacity: shape.opacity,
				isLocked: shape.isLocked,
			} );
		}

		const computePartials = () => {
			const partials: TLShapePartial[] = [];
			for ( const shape of editor.getCurrentPageShapes() ) {
				const keep = isAnnotationSessionShape( editor, shape, annotatingPreviewShapeId );
				const targetOpacity = keep ? 1 : ANNOTATE_DIM_OPACITY;
				const targetLocked = ! keep;
				const opacityChanged = Math.abs( shape.opacity - targetOpacity ) > 0.001;
				const lockChanged = shape.isLocked !== targetLocked;
				if ( ! opacityChanged && ! lockChanged ) {
					continue;
				}
				partials.push( {
					id: shape.id,
					type: shape.type,
					...( opacityChanged ? { opacity: targetOpacity } : {} ),
					...( lockChanged ? { isLocked: targetLocked } : {} ),
				} );
			}
			return partials;
		};

		const initialPartials = computePartials();
		if ( initialPartials.length > 0 ) {
			editor.animateShapes( initialPartials, { animation: { duration: 320 } } );
		}

		let frame = 0;
		const scheduleSync = () => {
			if ( frame ) {
				return;
			}
			frame = requestAnimationFrame( () => {
				frame = 0;
				const partials = computePartials();
				if ( partials.length > 0 ) {
					editor.updateShapes( partials );
				}
			} );
		};
		const unsubscribe = editor.store.listen( scheduleSync, { scope: 'document' } );

		return () => {
			unsubscribe();
			if ( frame ) {
				cancelAnimationFrame( frame );
			}
			const restorePartials: TLShapePartial[] = [];
			for ( const [ shapeId, original ] of originals.entries() ) {
				const shape = editor.getShape( shapeId );
				if ( ! shape ) {
					continue;
				}
				const opacityChanged = Math.abs( shape.opacity - original.opacity ) > 0.001;
				const lockChanged = shape.isLocked !== original.isLocked;
				if ( ! opacityChanged && ! lockChanged ) {
					continue;
				}
				restorePartials.push( {
					id: shapeId,
					type: shape.type,
					...( opacityChanged ? { opacity: original.opacity } : {} ),
					...( lockChanged ? { isLocked: original.isLocked } : {} ),
				} );
			}
			if ( restorePartials.length > 0 ) {
				editor.animateShapes( restorePartials, { animation: { duration: 320 } } );
			}
			const nextCanvas = document.querySelector( '[data-ui-desks-canvas]' );
			nextCanvas?.removeAttribute( 'data-ui-desks-annotating' );
		};
	}, [ annotatingPreviewShapeId, editor ] );

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
			annotatingPreviewShapeId,
			annotationCount,
			selectedAnnotationNoteShapeId,
			pendingAnnotation,
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
			startAnnotatingPreview,
			stopAnnotatingPreview,
			requestAnnotation,
			confirmPendingAnnotation,
			cancelPendingAnnotation,
			removeSelectedAnnotation,
			collectAnnotationSubmission,
		} ),
		[
			addPastedContent,
			addWidget,
			addWidgetAtScreenPoint,
			annotatingPreviewShapeId,
			annotationCount,
			cancelPendingAnnotation,
			collectAnnotationSubmission,
			confirmPendingAnnotation,
			editor,
			editSelectedWidget,
			fitSelectedWidgetToContent,
			finishDrawing,
			focusConnectedWidget,
			isHydrated,
			isReadOnly,
			isLoading,
			pendingAnnotation,
			pendingConnectorSourceId,
			pressStack,
			pressedStackId,
			registerEditor,
			removeSelectedAnnotation,
			removeSelectedConnector,
			removeSelectedWidget,
			requestAnnotation,
			selectedAnnotationNoteShapeId,
			selectedConnectorToolbarItem,
			selectedWidgetConnectionTargets,
			selectedWidgetToolbarItem,
			selectedWidgetEditAction,
			setSelectedStackView,
			stackSelectedWidgets,
			startAnnotatingPreview,
			startDrawing,
			startConnectingWidget,
			siteId,
			statusMessage,
			stopAnnotatingPreview,
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

function isSitePreviewShape( shape: unknown ): shape is RectangleWidgetShape {
	return (
		Boolean( shape ) &&
		typeof shape === 'object' &&
		( shape as Partial< TLShape > ).type === RECTANGLE_WIDGET_SHAPE_TYPE &&
		( shape as Partial< RectangleWidgetShape > ).props?.widgetType === SITE_PREVIEW_WIDGET_TYPE
	);
}

function isAnnotationSessionShape(
	editor: Editor,
	shape: TLShape,
	previewShapeId: TLShapeId
): boolean {
	if ( shape.id === previewShapeId ) {
		return true;
	}
	if ( isAnnotationNoteShapeForPreview( shape, previewShapeId ) ) {
		return true;
	}
	if ( ! isAnnotationConnectorShape( shape ) ) {
		return false;
	}

	const bindings = editor.getBindingsFromShape( shape.id, 'arrow' );
	const startBinding = bindings.find(
		( binding ) => getArrowBindingTerminal( binding.props ) === 'start'
	);
	const endBinding = bindings.find(
		( binding ) => getArrowBindingTerminal( binding.props ) === 'end'
	);
	const endShape = endBinding ? editor.getShape( endBinding.toId ) : null;
	return (
		startBinding?.toId === previewShapeId &&
		Boolean( endShape && isAnnotationNoteShapeForPreview( endShape, previewShapeId ) )
	);
}

function isAnnotationNoteShapeForPreview( shape: unknown, previewShapeId: TLShapeId ): boolean {
	if (
		! shape ||
		typeof shape !== 'object' ||
		( shape as Partial< TLShape > ).type !== RECTANGLE_WIDGET_SHAPE_TYPE
	) {
		return false;
	}
	const rectangleShape = shape as Partial< RectangleWidgetShape >;
	const widgetProps = rectangleShape.props?.widgetProps as
		| { annotation?: { previewShapeId?: unknown } }
		| undefined;
	return widgetProps?.annotation?.previewShapeId === previewShapeId;
}

function getArrowBindingTerminal( props: object ) {
	return ( props as { terminal?: unknown } ).terminal;
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
