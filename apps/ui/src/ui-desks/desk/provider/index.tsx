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

export function DeskProvider( { siteId, children }: DeskProviderProps ) {
	const { data: sites } = useSites();
	const { desk, isLoading, saveDeskConfig } = useDeskPersistence( siteId );
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const canUploadMedia = Boolean( siteId && site?.running );
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const [ isHydrated, setIsHydrated ] = useState( false );
	const [ selectedWidgetToolbarItem, setSelectedWidgetToolbarItem ] =
		useState< SelectedWidgetToolbarItem | null >( null );
	const [ pressedStackId, setPressedStackId ] = useState< string | null >( null );
	const hydratedRef = useRef( false );
	const creationOffsetRef = useRef( 0 );
	const saveTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	const { pressStack, clearPressedStack } = useStackPressAnimation( setPressedStackId );

	useStackInteractions( editor );

	useEffect( () => {
		if ( ! editor || isLoading || hydratedRef.current ) {
			return;
		}

		hydratedRef.current = true;
		hydrateEditorFromDesk( editor, desk );
		setIsHydrated( true );
		setSelectedWidgetToolbarItem( getCurrentSelectedWidgetToolbarItem( editor ) );
	}, [ desk, editor, isLoading ] );

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
				saveTimerRef.current = null;
				saveDeskConfig( createDeskConfigFromEditor( editor ) );
			}, 500 );
		};
		const syncSelectedWidgetToolbarItem = () => {
			setSelectedWidgetToolbarItem( getCurrentSelectedWidgetToolbarItem( editor ) );
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
	}, [ editor, saveDeskConfig ] );

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
			if ( ! editor || ! isHydrated ) {
				return false;
			}

			const didAddWidget = addWidgetToEditor( editor, type, creationOffsetRef.current, options );
			if ( didAddWidget ) {
				creationOffsetRef.current += 1;
			}
			return didAddWidget;
		},
		[ editor, isHydrated ]
	);

	const updateSelectedWidgetProps = useCallback(
		( widgetProps: Record< string, unknown > ) => {
			if ( ! editor || ! isHydrated ) {
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
		[ editor, isHydrated ]
	);

	const stackSelectedWidgets = useCallback( () => {
		if ( ! editor || ! isHydrated || ! stackSelectedWidgetsInEditor( editor ) ) {
			return false;
		}

		setSelectedWidgetToolbarItem( getCurrentSelectedWidgetToolbarItem( editor ) );
		return true;
	}, [ editor, isHydrated ] );

	const unstackSelectedWidgets = useCallback( () => {
		if ( ! editor || ! isHydrated || ! unstackSelectedWidgetsInEditor( editor ) ) {
			return false;
		}

		setSelectedWidgetToolbarItem( getCurrentSelectedWidgetToolbarItem( editor ) );
		return true;
	}, [ editor, isHydrated ] );

	const removeSelectedWidget = useCallback( () => {
		if ( ! editor || ! isHydrated || ! removeSelectedWidgetFromEditor( editor ) ) {
			return false;
		}

		setSelectedWidgetToolbarItem( null );
		return true;
	}, [ editor, isHydrated ] );

	const value = useMemo(
		() => ( {
			siteId,
			isLoading,
			canAddWidgets: Boolean( editor ) && isHydrated,
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
			isLoading,
			pressStack,
			pressedStackId,
			registerEditor,
			removeSelectedWidget,
			selectedWidgetToolbarItem,
			stackSelectedWidgets,
			siteId,
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
