import { __ } from '@wordpress/i18n';
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
	canvasShapeToDeskWidget,
	CONNECTOR_SHAPE_ID_PREFIX,
	deskConfigToCanvasConnectorBindings,
	deskConfigToCanvasConnectorShapes,
	deskConfigToCanvasShapes,
	deskWidgetToCanvasShape,
	getTemporaryDeskCanvasRecordMeta,
} from '@/ui-desks/desk/tldraw-adapter';
import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';
import { createEmptyFocusDesk } from '@/ui-desks/focus-mode/types';
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
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import { SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import {
	DeskContext,
	type AddDeskWidgetOptions,
	type DeskProviderProps,
	type SelectedWidgetToolbarItem,
	type SiteCardEditAction,
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
import type { DeskFocusDesk, DeskFocusMode } from '@/ui-desks/focus-mode/types';
import type {
	DeskWidget,
	WidgetHandlerLoading,
	WidgetHandlerResult,
	WidgetPastePayload,
} from '@/ui-desks/widgets/types';

export { useDesk, useRegisterDeskEditor } from './context';

const FOCUS_DIM_OPACITY = 0.08;
const FOCUS_CAMERA_ANIMATION_DURATION = 320;
const FOCUS_PERSISTENCE_RESUME_DELAY = FOCUS_CAMERA_ANIMATION_DURATION + 80;

interface FocusShapeRestoreSnapshot {
	type: string;
	opacity: number;
	isLocked: boolean;
}

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
	const [ focusMode, setFocusModeState ] = useState< DeskFocusMode | null >( null );
	const [ focusedWidget, setFocusedWidget ] = useState< DeskWidget | null >( null );
	const [ siteCardEditAction, setSiteCardEditAction ] = useState< SiteCardEditAction | null >(
		null
	);
	const [ isSiteCardEditDirty, setIsSiteCardEditDirtyState ] = useState( false );
	const [ isSiteCardEditSaving, setIsSiteCardEditSavingState ] = useState( false );
	const [ pressedStackId, setPressedStackId ] = useState< string | null >( null );
	const hydratedRef = useRef( false );
	const deskConfigKeyRef = useRef< string | undefined >( undefined );
	const creationOffsetRef = useRef( 0 );
	const drawingStartShapeIdsRef = useRef< Set< string > | null >( null );
	const focusRestoreCameraRef = useRef< { x: number; y: number; z: number } | null >( null );
	const focusShapeIdsRef = useRef< Set< TLShapeId > >( new Set() );
	const focusShapeRestoreRef = useRef< Map< TLShapeId, FocusShapeRestoreSnapshot > >( new Map() );
	const focusDimmingActiveRef = useRef( false );
	const focusPersistencePausedRef = useRef( false );
	const focusPersistenceResumeTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
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
	const focusedWidgetDefinition = useMemo(
		() => ( focusedWidget ? getWidgetDefinition( focusedWidget.type ) ?? null : null ),
		[ focusedWidget ]
	);

	useStackInteractions( editor );
	useConnectorInteractions( {
		editor,
		isHydrated,
		isReadOnly,
		pendingConnectorSourceId,
		setPendingConnectorSourceId,
	} );

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
		setFocusModeState( null );
		setFocusedWidget( null );
		setSiteCardEditAction( null );
		setIsSiteCardEditDirtyState( false );
		setIsSiteCardEditSavingState( false );
		focusDimmingActiveRef.current = false;
		focusPersistencePausedRef.current = false;
		if ( focusPersistenceResumeTimerRef.current ) {
			clearTimeout( focusPersistenceResumeTimerRef.current );
			focusPersistenceResumeTimerRef.current = null;
		}
		if ( editor ) {
			restoreFocusModeShapeState( editor, focusShapeRestoreRef.current );
			focusShapeIdsRef.current = syncFocusDeskToEditor( editor, null, focusShapeIdsRef.current );
		} else {
			focusShapeIdsRef.current = new Set();
		}
		focusRestoreCameraRef.current = null;
		focusShapeRestoreRef.current.clear();
		drawingStartShapeIdsRef.current = null;
	}, [ deskConfigKey, editor ] );

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
			if ( isReadOnly || ! hydratedRef.current || focusPersistencePausedRef.current ) {
				return;
			}

			if ( saveTimerRef.current ) {
				clearTimeout( saveTimerRef.current );
			}

			saveTimerRef.current = setTimeout( () => {
				saveTimerRef.current = null;
				if ( focusPersistencePausedRef.current ) {
					return;
				}
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
				setFocusModeState( null );
				setFocusedWidget( null );
				setSiteCardEditAction( null );
				setIsSiteCardEditDirtyState( false );
				setIsSiteCardEditSavingState( false );
				focusRestoreCameraRef.current = null;
				focusShapeIdsRef.current = new Set();
				focusShapeRestoreRef.current.clear();
				focusDimmingActiveRef.current = false;
				focusPersistencePausedRef.current = false;
				if ( focusPersistenceResumeTimerRef.current ) {
					clearTimeout( focusPersistenceResumeTimerRef.current );
					focusPersistenceResumeTimerRef.current = null;
				}
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

	const startFocusMode = useCallback(
		( widgetId: string, initialFocusDesk: DeskFocusDesk = createEmptyFocusDesk() ) => {
			if ( isReadOnly || ! editor || ! isHydrated ) {
				return false;
			}
			const shapeId = createShapeId( widgetId );
			const shape = editor.getShape( shapeId );
			const widget = shape ? canvasShapeToDeskWidget( shape ) : null;
			const bounds = editor.getShapePageBounds( shapeId );
			if ( ! widget || ! bounds ) {
				return false;
			}

			if ( saveTimerRef.current ) {
				clearTimeout( saveTimerRef.current );
				saveTimerRef.current = null;
				saveDeskConfig( createDeskConfigFromEditor( editor ) );
			}
			if ( focusPersistenceResumeTimerRef.current ) {
				clearTimeout( focusPersistenceResumeTimerRef.current );
				focusPersistenceResumeTimerRef.current = null;
			}
			focusPersistencePausedRef.current = true;
			focusRestoreCameraRef.current = { ...editor.getCamera() };
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
			editor.zoomToBounds( paddedBounds, {
				animation: { duration: FOCUS_CAMERA_ANIMATION_DURATION },
			} );
			editor.setSelectedShapes( [ shapeId ] );
			editor.setCameraOptions( { ...editor.getCameraOptions(), isLocked: true } );
			setPendingConnectorSourceId( null );
			setSiteCardEditAction( null );
			setIsSiteCardEditDirtyState( false );
			setIsSiteCardEditSavingState( false );
			setFocusedWidget( widget );
			setFocusModeState( { widgetId, focusDesk: initialFocusDesk } );
			editor.focus();
			return true;
		},
		[ editor, isHydrated, isReadOnly, saveDeskConfig ]
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

		if ( selectedWidgetEditAction.kind === 'focus-mode' ) {
			if ( selectedWidgetToolbarItem?.kind !== 'single-widget' ) {
				return false;
			}

			return startFocusMode( selectedWidgetToolbarItem.widget.id );
		}

		if ( ! siteId ) {
			return false;
		}

		void connector.openSiteUrl( siteId, selectedWidgetEditAction.path );
		return true;
	}, [
		connector,
		editor,
		selectedWidgetEditAction,
		selectedWidgetToolbarItem,
		siteId,
		startFocusMode,
	] );

	const setFocusDesk = useCallback( ( nextFocusDesk: DeskFocusDesk ) => {
		let didUpdate = false;
		setFocusModeState( ( current ) => {
			if ( ! current ) {
				return current;
			}
			didUpdate = true;
			return {
				...current,
				focusDesk: nextFocusDesk,
			};
		} );
		return didUpdate;
	}, [] );

	const getFocusDeskSnapshot = useCallback( (): DeskFocusDesk | null => {
		if ( ! editor || ! focusMode ) {
			return null;
		}

		return {
			...focusMode.focusDesk,
			widgets: focusMode.focusDesk.widgets
				.map( ( widget ) => {
					const shape = editor.getShape( createShapeId( widget.id ) );
					return shape ? canvasShapeToDeskWidget( shape ) ?? widget : widget;
				} )
				.filter( ( widget ): widget is DeskWidget => Boolean( widget ) ),
		};
	}, [ editor, focusMode ] );

	const stopFocusMode = useCallback( () => {
		if ( ! editor ) {
			return false;
		}
		focusDimmingActiveRef.current = false;
		restoreFocusModeShapeState( editor, focusShapeRestoreRef.current );
		focusShapeRestoreRef.current.clear();
		focusShapeIdsRef.current = syncFocusDeskToEditor( editor, null, focusShapeIdsRef.current );
		document
			.querySelector( '[data-ui-desks-canvas]' )
			?.removeAttribute( 'data-ui-desks-focus-mode' );
		editor.setCameraOptions( { ...editor.getCameraOptions(), isLocked: false } );
		const restoreCamera = focusRestoreCameraRef.current;
		if ( restoreCamera ) {
			editor.setCamera( restoreCamera, {
				animation: { duration: FOCUS_CAMERA_ANIMATION_DURATION },
				force: true,
			} );
			focusRestoreCameraRef.current = null;
		}
		if ( focusPersistenceResumeTimerRef.current ) {
			clearTimeout( focusPersistenceResumeTimerRef.current );
		}
		focusPersistenceResumeTimerRef.current = setTimeout( () => {
			focusPersistencePausedRef.current = false;
			focusPersistenceResumeTimerRef.current = null;
		}, FOCUS_PERSISTENCE_RESUME_DELAY );
		setFocusModeState( null );
		setFocusedWidget( null );
		setSiteCardEditAction( null );
		setIsSiteCardEditDirtyState( false );
		setIsSiteCardEditSavingState( false );
		editor.focus();
		return true;
	}, [ editor ] );

	const requestSiteCardEditAction = useCallback(
		( action: 'save' | 'cancel' ) => {
			if (
				! focusMode ||
				! focusedWidget ||
				focusMode.widgetId !== focusedWidget.id ||
				focusedWidget.type !== SITE_CARD_WIDGET_TYPE
			) {
				return false;
			}
			if ( action === 'save' && isSiteCardEditSaving ) {
				return false;
			}

			setSiteCardEditAction( {
				widgetId: focusedWidget.id,
				action,
				token: Date.now(),
			} );
			return true;
		},
		[ focusMode, focusedWidget, isSiteCardEditSaving ]
	);

	const completeSiteCardEdit = useCallback(
		( widgetId: string ) => {
			setSiteCardEditAction( ( currentAction ) =>
				currentAction?.widgetId === widgetId ? null : currentAction
			);
			setIsSiteCardEditDirtyState( false );
			setIsSiteCardEditSavingState( false );
			if ( focusMode?.widgetId === widgetId ) {
				stopFocusMode();
			}
		},
		[ focusMode?.widgetId, stopFocusMode ]
	);

	const setSiteCardEditDirty = useCallback(
		( widgetId: string, isDirty: boolean ) => {
			setIsSiteCardEditDirtyState( ( currentIsDirty ) => {
				return focusMode?.widgetId === widgetId &&
					focusedWidget?.type === SITE_CARD_WIDGET_TYPE &&
					currentIsDirty !== isDirty
					? isDirty
					: currentIsDirty;
			} );
		},
		[ focusMode?.widgetId, focusedWidget?.type ]
	);

	const setSiteCardEditSaving = useCallback(
		( widgetId: string, isSaving: boolean ) => {
			setIsSiteCardEditSavingState( ( currentIsSaving ) => {
				return focusMode?.widgetId === widgetId &&
					focusedWidget?.type === SITE_CARD_WIDGET_TYPE &&
					currentIsSaving !== isSaving
					? isSaving
					: currentIsSaving;
			} );
		},
		[ focusMode?.widgetId, focusedWidget?.type ]
	);

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		focusShapeIdsRef.current = syncFocusDeskToEditor(
			editor,
			focusMode?.focusDesk ?? null,
			focusShapeIdsRef.current
		);
	}, [ editor, focusMode?.focusDesk ] );

	const focusedWidgetId = focusMode?.widgetId ?? null;
	useEffect( () => {
		const canvas = document.querySelector( '[data-ui-desks-canvas]' );
		if ( canvas ) {
			if ( focusedWidgetId ) {
				canvas.setAttribute( 'data-ui-desks-focus-mode', focusedWidgetId );
			} else {
				canvas.removeAttribute( 'data-ui-desks-focus-mode' );
			}
		}

		if ( ! editor || ! focusedWidgetId ) {
			return;
		}

		const focusRootShapeId = createShapeId( focusedWidgetId );
		const restoreState = focusShapeRestoreRef.current;
		focusDimmingActiveRef.current = true;

		const computePartials = () => {
			if ( ! focusDimmingActiveRef.current ) {
				return [];
			}
			const partials: TLShapePartial[] = [];
			const focusShapeIds = getFocusSessionShapeIds( focusRootShapeId, focusShapeIdsRef.current );
			for ( const shape of editor.getCurrentPageShapes() ) {
				if ( ! restoreState.has( shape.id ) ) {
					restoreState.set( shape.id, {
						type: shape.type,
						opacity: shape.opacity,
						isLocked: shape.isLocked,
					} );
				}
				const keep = focusShapeIds.has( shape.id );
				const targetOpacity = keep ? 1 : FOCUS_DIM_OPACITY;
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
			updateFocusModeShapes( editor, initialPartials, true );
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
					updateFocusModeShapes( editor, partials, false );
				}
			} );
		};
		const unsubscribe = editor.store.listen( scheduleSync, { scope: 'document' } );

		return () => {
			focusDimmingActiveRef.current = false;
			unsubscribe();
			if ( frame ) {
				cancelAnimationFrame( frame );
			}
			restoreFocusModeShapeState( editor, restoreState );
			restoreState.clear();
			const nextCanvas = document.querySelector( '[data-ui-desks-canvas]' );
			nextCanvas?.removeAttribute( 'data-ui-desks-focus-mode' );
		};
	}, [ editor, focusedWidgetId ] );

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
			focusMode,
			focusedWidget,
			focusedWidgetDefinition,
			siteCardEditAction,
			isSiteCardEditDirty,
			isSiteCardEditSaving,
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
			requestSiteCardEditAction,
			completeSiteCardEdit,
			setSiteCardEditDirty,
			setSiteCardEditSaving,
			fitSelectedWidgetToContent,
			stackSelectedWidgets,
			unstackSelectedWidgets,
			setSelectedStackView,
			removeSelectedWidget,
			removeSelectedConnector,
			startConnectingWidget,
			focusConnectedWidget,
			startFocusMode,
			setFocusDesk,
			getFocusDeskSnapshot,
			stopFocusMode,
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
			focusedWidget,
			focusedWidgetDefinition,
			focusMode,
			getFocusDeskSnapshot,
			completeSiteCardEdit,
			isHydrated,
			isReadOnly,
			isLoading,
			isSiteCardEditDirty,
			isSiteCardEditSaving,
			pendingConnectorSourceId,
			pressStack,
			pressedStackId,
			registerEditor,
			removeSelectedConnector,
			removeSelectedWidget,
			requestSiteCardEditAction,
			selectedConnectorToolbarItem,
			selectedWidgetConnectionTargets,
			selectedWidgetToolbarItem,
			selectedWidgetEditAction,
			setFocusDesk,
			setSiteCardEditDirty,
			setSiteCardEditSaving,
			setSelectedStackView,
			siteCardEditAction,
			stackSelectedWidgets,
			startDrawing,
			startConnectingWidget,
			startFocusMode,
			siteId,
			statusMessage,
			stopFocusMode,
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

function syncFocusDeskToEditor(
	editor: Editor,
	focusDesk: DeskFocusDesk | null,
	previousShapeIds: Set< TLShapeId >
) {
	const nextShapeIds = focusDesk ? getFocusDeskShapeIds( focusDesk ) : new Set< TLShapeId >();
	const shapeIdsToDelete = [ ...previousShapeIds ].filter(
		( shapeId ) => ! nextShapeIds.has( shapeId ) && Boolean( editor.getShape( shapeId ) )
	);
	if ( shapeIdsToDelete.length > 0 ) {
		editor.run( () => editor.deleteShapes( shapeIdsToDelete ), { ignoreShapeLock: true } );
	}

	if ( ! focusDesk || focusDesk.widgets.length === 0 ) {
		return nextShapeIds;
	}

	const deskConfig: DeskConfig = {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		widgets: focusDesk.widgets,
		...( focusDesk.stacks?.length ? { stacks: focusDesk.stacks } : {} ),
		...( focusDesk.connectors?.length ? { connectors: focusDesk.connectors } : {} ),
	};
	const widgetShapes = deskConfigToCanvasShapes( deskConfig ).map( withTemporaryFocusMeta );
	const connectorShapes = deskConfigToCanvasConnectorShapes( deskConfig, widgetShapes ).map(
		withTemporaryFocusMeta
	);
	const nextShapes = [ ...connectorShapes, ...widgetShapes ];
	const existingShapeIds = new Set(
		nextShapes
			.map( ( shape ) => shape.id )
			.filter(
				( shapeId ): shapeId is TLShapeId =>
					Boolean( shapeId ) && Boolean( editor.getShape( shapeId ) )
			)
	);
	const shapeIdsToReplace = [ ...existingShapeIds ];
	if ( shapeIdsToReplace.length > 0 ) {
		editor.run( () => editor.deleteShapes( shapeIdsToReplace ), { ignoreShapeLock: true } );
	}
	editor.createShapes( nextShapes );
	editor.createBindings( deskConfigToCanvasConnectorBindings( deskConfig ) );
	return nextShapeIds;
}

function withTemporaryFocusMeta< TShape extends TLShapePartial >( shape: TShape ): TShape {
	return {
		...shape,
		meta: getTemporaryDeskCanvasRecordMeta( shape ),
	};
}

function updateFocusModeShapes( editor: Editor, partials: TLShapePartial[], animated: boolean ) {
	editor.run(
		() => {
			if ( animated ) {
				editor.animateShapes( partials, { animation: { duration: 320 } } );
				return;
			}
			editor.updateShapes( partials );
		},
		{ ignoreShapeLock: true }
	);
}

function restoreFocusModeShapeState(
	editor: Editor,
	restoreState: Map< TLShapeId, FocusShapeRestoreSnapshot >
) {
	const restorePartials: TLShapePartial[] = [];
	for ( const [ shapeId, original ] of restoreState.entries() ) {
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
			type: original.type,
			...( opacityChanged ? { opacity: original.opacity } : {} ),
			...( lockChanged ? { isLocked: original.isLocked } : {} ),
		} );
	}
	if ( restorePartials.length > 0 ) {
		updateFocusModeShapes( editor, restorePartials, false );
	}
}

function getFocusSessionShapeIds( rootShapeId: TLShapeId, focusDeskShapeIds: Set< TLShapeId > ) {
	return new Set< TLShapeId >( [ rootShapeId, ...focusDeskShapeIds ] );
}

function getFocusDeskShapeIds( focusDesk: DeskFocusDesk ) {
	return new Set< TLShapeId >( [
		...focusDesk.widgets.map( ( widget ) => createShapeId( widget.id ) ),
		...( focusDesk.connectors ?? [] ).map( ( connector ) => getConnectorShapeId( connector.id ) ),
	] );
}

function getConnectorShapeId( connectorId: string ) {
	return createShapeId( `${ CONNECTOR_SHAPE_ID_PREFIX }${ connectorId }` );
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
