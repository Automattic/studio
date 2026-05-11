import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createShapeId, type Editor, type JsonObject } from 'tldraw';
import { useSites } from '@/data/queries/use-sites';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { useStackInteractions } from '@/ui-desks/stacks/use-stack-interactions';
import { useStackPressAnimation } from '@/ui-desks/stacks/use-stack-press-animation';
import { getWidgetFileHandler } from '@/ui-desks/widgets/file-handlers';
import {
	DeskContext,
	type AddDeskWidgetOptions,
	type DeskProviderProps,
	type SelectedWidgetToolbarItem,
} from './context';
import {
	addWidgetToEditor,
	createWidgetId,
	createDeskConfigFromEditor,
	getCurrentSelectedWidgetToolbarItem,
	hasCameraChange,
	hasPersistentDocumentChange,
	hydrateEditorFromDesk,
	removeSelectedWidgetFromEditor,
	stackSelectedWidgetsInEditor,
	unstackSelectedWidgetsInEditor,
	updateSelectedWidgetPropsInEditor,
} from './editor-state';
import { useDeskPersistence } from './persistence';
import { useDeskWidgetResolvers } from './resolvers';
import type {
	DeskWidget,
	DeskWidgetDefinition,
	WidgetFileHandlerCreatedContext,
	WidgetFileHandlerUpdate,
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
	const saveTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	const { pressStack, clearPressedStack } = useStackPressAnimation( setPressedStackId );
	const toolbarStateOptions = useMemo(
		() => ( {
			canStack: ! isReadOnly,
			canUnstack: ! isReadOnly,
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
			const createdHandlers: Array< () => Promise< void > > = [];

			for ( const { file, match } of handledFiles ) {
				if ( editor.isDisposed ) {
					return;
				}

				try {
					const result = await match.handler.createWidget( file, { siteId } );
					if ( ! result ) {
						continue;
					}

					const widgetId = createWidgetId();
					const shapeId = createShapeId( widgetId ) as RectangleWidgetShape[ 'id' ];
					const didAddWidget = addWidgetToEditor( editor, match.definition.type, 0, {
						id: widgetId,
						center: {
							x: cursorX,
							y: cursorY,
						},
						shapeProps: result.shapeProps,
						widgetProps: result.widgetProps,
						shouldStartEditing: result.shouldStartEditing,
					} );

					if ( ! didAddWidget ) {
						continue;
					}

					const size = getDroppedWidgetSize( editor, shapeId );
					cursorX += size.w + 20;

					if ( result.onWidgetCreated ) {
						createdHandlers.push( () =>
							Promise.resolve(
								result.onWidgetCreated?.(
									createWidgetFileHandlerCreatedContext( {
										editor,
										definition: match.definition,
										file,
										shapeId,
										siteId,
										widgetId,
									} )
								)
							)
						);
					}
				} catch ( error ) {
					console.warn( 'Failed to create dropped file widget.', error );
				}
			}

			await Promise.all( createdHandlers.map( ( handleCreated ) => handleCreated() ) );
		} );

		return () => {
			editor.registerExternalContentHandler( 'files', null );
		};
	}, [ editor, isHydrated, isReadOnly, isRunningSite, siteId ] );

	const registerEditor = useCallback(
		( nextEditor: Editor | null ) => {
			setEditor( nextEditor );
			if ( ! nextEditor ) {
				hydratedRef.current = false;
				setIsHydrated( false );
				setSelectedWidgetToolbarItem( null );
				clearPressedStack();
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
			updateSelectedWidgetProps,
			stackSelectedWidgets,
			unstackSelectedWidgets,
			removeSelectedWidget,
		} ),
		[
			addWidget,
			editor,
			isHydrated,
			isReadOnly,
			isLoading,
			pressStack,
			pressedStackId,
			registerEditor,
			removeSelectedWidget,
			selectedWidgetToolbarItem,
			stackSelectedWidgets,
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

type HandledDroppedFile = {
	file: File;
	match: NonNullable< ReturnType< typeof getWidgetFileHandler > >;
};

function createWidgetFileHandlerCreatedContext( {
	editor,
	definition,
	file,
	shapeId,
	siteId,
	widgetId,
}: {
	editor: Editor;
	definition: DeskWidgetDefinition;
	file: File;
	shapeId: RectangleWidgetShape[ 'id' ];
	siteId?: string;
	widgetId: string;
} ): WidgetFileHandlerCreatedContext< DeskWidget > {
	return {
		file,
		siteId,
		widgetId,
		updateWidget: ( update ) => updateDroppedWidget( editor, definition, shapeId, update ),
		deleteWidget: () => deleteDroppedWidget( editor, shapeId ),
	};
}

function updateDroppedWidget(
	editor: Editor,
	definition: DeskWidgetDefinition,
	shapeId: RectangleWidgetShape[ 'id' ],
	update: WidgetFileHandlerUpdate< DeskWidget >
) {
	if ( editor.isDisposed ) {
		return false;
	}

	const shape = editor.getShape( shapeId );
	if ( ! isRectangleWidgetShape( shape ) ) {
		return false;
	}

	const shapeProps = {
		...shape.props.shapeProps,
		...update.shapeProps,
	};
	const widgetProps = {
		...shape.props.widgetProps,
		...update.widgetProps,
	};
	if ( ! definition.isWidgetProps( widgetProps ) ) {
		return false;
	}

	editor.updateShape< RectangleWidgetShape >( {
		id: shapeId,
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		props: {
			...( update.shapeProps ? { shapeProps } : {} ),
			...( update.widgetProps ? { widgetProps: widgetProps as JsonObject } : {} ),
		},
	} );

	return true;
}

function deleteDroppedWidget( editor: Editor, shapeId: RectangleWidgetShape[ 'id' ] ) {
	if ( ! editor.isDisposed && editor.getShape( shapeId ) ) {
		editor.deleteShapes( [ shapeId ] );
	}
}

function getDroppedWidgetSize( editor: Editor, shapeId: RectangleWidgetShape[ 'id' ] ) {
	const shape = editor.getShape( shapeId );
	if ( isRectangleWidgetShape( shape ) ) {
		return shape.props.shapeProps;
	}

	return { w: 320, h: 320 };
}

function isRectangleWidgetShape( shape: unknown ): shape is RectangleWidgetShape {
	return (
		Boolean( shape ) &&
		typeof shape === 'object' &&
		( shape as { type?: unknown } ).type === RECTANGLE_WIDGET_SHAPE_TYPE
	);
}
