import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	createShapeId,
	getIndexAbove,
	sortByIndex,
	type Editor,
	type TLShape,
	type TLShapePartial,
} from 'tldraw';
import { useSites } from '@/data/queries/use-sites';
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
import { createDeskWidget } from '@/ui-desks/widgets/create-widget';
import { getWidgetFileHandler } from '@/ui-desks/widgets/file-handlers';
import { LOADING_WIDGET_TYPE } from '@/ui-desks/widgets/loading/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { createUrlPastePayload, getWidgetPasteHandler } from '@/ui-desks/widgets/paste-handlers';
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
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const isRunningSite = Boolean( siteId && site?.running );
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const [ isHydrated, setIsHydrated ] = useState( false );
	const [ selectedWidgetToolbarItem, setSelectedWidgetToolbarItem ] =
		useState< SelectedWidgetToolbarItem | null >( null );
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

	useStackInteractions( editor );

	useEffect( () => {
		if ( deskConfigKeyRef.current === deskConfigKey ) {
			return;
		}

		deskConfigKeyRef.current = deskConfigKey;
		hydratedRef.current = false;
		setIsHydrated( false );
		setSelectedWidgetToolbarItem( null );
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
	}, [ editor, isHydrated, isReadOnly, isRunningSite, siteId ] );

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

	const value = useMemo(
		() => ( {
			siteId,
			isLoading,
			isReadOnly,
			statusMessage,
			canAddWidgets: ! isReadOnly && Boolean( editor ) && isHydrated,
			selectedWidgetToolbarItem,
			pressedStackId,
			registerEditor,
			pressStack,
			addWidget,
			addPastedContent,
			startDrawing,
			finishDrawing,
			updateSelectedWidgetProps,
			fitSelectedWidgetToContent,
			stackSelectedWidgets,
			unstackSelectedWidgets,
			setSelectedStackView,
			removeSelectedWidget,
		} ),
		[
			addPastedContent,
			addWidget,
			editor,
			fitSelectedWidgetToContent,
			finishDrawing,
			isHydrated,
			isReadOnly,
			isLoading,
			pressStack,
			pressedStackId,
			registerEditor,
			removeSelectedWidget,
			selectedWidgetToolbarItem,
			setSelectedStackView,
			stackSelectedWidgets,
			startDrawing,
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
	match,
	placeholder,
	siteId,
}: {
	editor: Editor;
	file: File;
	match: NonNullable< ReturnType< typeof getWidgetFileHandler > >;
	placeholder: TemporaryLoadingWidget;
	siteId?: string;
} ) {
	try {
		const result = await match.handler.handle( file, { siteId } );
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
