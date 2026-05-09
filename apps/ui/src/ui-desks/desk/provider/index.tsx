import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StackAnimationContext } from '@/ui-desks/stacks/context';
import {
	useStackInteractions,
	type StackInteractionState,
} from '@/ui-desks/stacks/use-stack-interactions';
import {
	DeskContext,
	DeskEditorRegistrationContext,
	type AddDeskWidgetOptions,
	type DeskProviderProps,
	type SelectedWidgetToolbarItem,
} from './context';
import {
	addWidgetToEditor,
	createDeskConfigFromEditor,
	getCurrentSelectedWidgetToolbarItem,
	hasCameraChange,
	hydrateEditorFromDesk,
	removeSelectedWidgetFromEditor,
	stackSelectedWidgetsInEditor,
	unstackSelectedWidgetsInEditor,
	updateSelectedWidgetPropsInEditor,
} from './editor-state';
import { useDeskPersistence } from './persistence';
import type { Editor } from 'tldraw';

export { useDesk, useRegisterDeskEditor } from './context';

export function DeskProvider( { siteId, children }: DeskProviderProps ) {
	const { desk, isLoading, saveDeskConfig } = useDeskPersistence( siteId );
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const [ isHydrated, setIsHydrated ] = useState( false );
	const [ selectedWidgetToolbarItem, setSelectedWidgetToolbarItem ] =
		useState< SelectedWidgetToolbarItem | null >( null );
	const [ pressedStackId, setPressedStackId ] = useState< string | null >( null );
	const hydratedRef = useRef( false );
	const creationOffsetRef = useRef( 0 );
	const saveTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	const stackPressTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	const isStackPointerSessionRef = useRef( false );
	const pointerDownStackIdRef = useRef< string | null >( null );
	const movedStackShapeIdsRef = useRef( new Set< string >() );
	const stackInteractionState = useMemo< StackInteractionState >(
		() => ( {
			isPointerSessionRef: isStackPointerSessionRef,
			pointerDownStackIdRef,
			movedShapeIdsRef: movedStackShapeIdsRef,
		} ),
		[ isStackPointerSessionRef, movedStackShapeIdsRef, pointerDownStackIdRef ]
	);

	useStackInteractions( editor, stackInteractionState );

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
			() => {
				queueSave();
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

	const registerEditor = useCallback( ( nextEditor: Editor | null ) => {
		setEditor( nextEditor );
		if ( ! nextEditor ) {
			hydratedRef.current = false;
			setIsHydrated( false );
			setSelectedWidgetToolbarItem( null );
			setPressedStackId( null );
			if ( stackPressTimerRef.current ) {
				clearTimeout( stackPressTimerRef.current );
				stackPressTimerRef.current = null;
			}
			isStackPointerSessionRef.current = false;
			pointerDownStackIdRef.current = null;
			movedStackShapeIdsRef.current.clear();
		}
	}, [] );

	const pressStack = useCallback( ( stackId: string ) => {
		if ( stackPressTimerRef.current ) {
			clearTimeout( stackPressTimerRef.current );
		}

		setPressedStackId( stackId );
		stackPressTimerRef.current = setTimeout( () => {
			stackPressTimerRef.current = null;
			setPressedStackId( ( currentStackId ) =>
				currentStackId === stackId ? null : currentStackId
			);
		}, 180 );
	}, [] );

	useEffect( () => {
		return () => {
			if ( stackPressTimerRef.current ) {
				clearTimeout( stackPressTimerRef.current );
			}
		};
	}, [] );

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
			removeSelectedWidget,
			selectedWidgetToolbarItem,
			stackSelectedWidgets,
			siteId,
			unstackSelectedWidgets,
			updateSelectedWidgetProps,
		]
	);
	const stackAnimationContextValue = useMemo(
		() => ( {
			pressedStackId,
			pressStack,
		} ),
		[ pressStack, pressedStackId ]
	);

	return (
		<DeskEditorRegistrationContext.Provider value={ registerEditor }>
			<DeskContext.Provider value={ value }>
				<StackAnimationContext.Provider value={ stackAnimationContextValue }>
					{ children }
				</StackAnimationContext.Provider>
			</DeskContext.Provider>
		</DeskEditorRegistrationContext.Provider>
	);
}
