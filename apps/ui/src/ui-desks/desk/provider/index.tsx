import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StackProvider } from '@/ui-desks/stacks/provider';
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
	const hydratedRef = useRef( false );
	const creationOffsetRef = useRef( 0 );
	const saveTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

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
		}
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

	return (
		<DeskEditorRegistrationContext.Provider value={ registerEditor }>
			<DeskContext.Provider value={ value }>
				<StackProvider editor={ editor }>{ children }</StackProvider>
			</DeskContext.Provider>
		</DeskEditorRegistrationContext.Provider>
	);
}
