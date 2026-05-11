import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createShapeId, type Editor } from 'tldraw';
import { useSites } from '@/data/queries/use-sites';
import { uploadSiteMedia } from '@/data/wordpress/media';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { useStackInteractions } from '@/ui-desks/stacks/use-stack-interactions';
import { useStackPressAnimation } from '@/ui-desks/stacks/use-stack-press-animation';
import { MEDIA_WIDGET_TYPE, type MediaKind } from '@/ui-desks/widgets/media/types';
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
	const canUploadMedia = Boolean( ! isReadOnly && siteId && site?.running );
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
		if ( ! editor || ! isHydrated ) {
			return;
		}

		editor.registerExternalContentHandler( 'files', async ( { files, point } ) => {
			if ( ! siteId || ! canUploadMedia ) {
				return;
			}

			const mediaFiles = files
				.map( ( file ) => ( { file, mediaKind: getDroppedMediaKind( file ) } ) )
				.filter(
					( item ): item is { file: File; mediaKind: MediaKind } => item.mediaKind !== null
				);

			if ( mediaFiles.length === 0 ) {
				return;
			}

			const dropPoint = point ?? editor.getViewportPageBounds().center;
			let cursorX = dropPoint.x;
			const cursorY = dropPoint.y;
			const queuedUploads: Array< {
				file: File;
				mediaKind: MediaKind;
				shapeId: RectangleWidgetShape[ 'id' ];
			} > = [];

			for ( const { file, mediaKind } of mediaFiles ) {
				if ( editor.isDisposed ) {
					return;
				}

				const widgetId = createWidgetId();
				const shapeId = createShapeId( widgetId ) as RectangleWidgetShape[ 'id' ];
				const didAddWidget = addWidgetToEditor( editor, MEDIA_WIDGET_TYPE, 0, {
					id: widgetId,
					center: {
						x: cursorX,
						y: cursorY,
					},
					widgetProps: {
						url: '',
						mediaKind,
						alt: file.name,
						mediaId: null,
					},
					shouldStartEditing: false,
				} );

				if ( ! didAddWidget ) {
					continue;
				}

				queuedUploads.push( {
					file,
					mediaKind,
					shapeId,
				} );
				cursorX += 340;
			}

			await Promise.all(
				queuedUploads.map( async ( { file, mediaKind, shapeId } ) => {
					try {
						const uploadedMedia = await uploadSiteMedia( file );
						if ( editor.isDisposed ) {
							return;
						}

						editor.updateShape< RectangleWidgetShape >( {
							id: shapeId,
							type: RECTANGLE_WIDGET_SHAPE_TYPE,
							props: {
								widgetProps: {
									url: uploadedMedia.source_url,
									mediaKind,
									alt: uploadedMedia.alt_text || file.name,
									mediaId: uploadedMedia.id,
								},
							},
						} );
					} catch ( error ) {
						console.warn( 'Failed to upload dropped media.', error );
						if ( ! editor.isDisposed && editor.getShape( shapeId ) ) {
							editor.deleteShapes( [ shapeId ] );
						}
					}
				} )
			);
		} );

		return () => {
			editor.registerExternalContentHandler( 'files', null );
		};
	}, [ canUploadMedia, editor, isHydrated, siteId ] );

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

function getDroppedMediaKind( file: File ): MediaKind | null {
	if ( file.type.startsWith( 'image/' ) ) {
		return 'image';
	}

	if ( file.type.startsWith( 'video/' ) ) {
		return 'video';
	}

	return null;
}
