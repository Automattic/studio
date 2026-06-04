import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	type Dispatch,
	type MutableRefObject,
	type ReactNode,
} from 'react';
import type { Annotation } from '@/components/site-preview/types';

// Dashboard-scoped UI store. Holds the slices of UI state that the chat agent
// can influence (preview panel today; future: composer, conversation pane,
// modals, etc.) so that components can read/update them while a separate
// bridge — `useSessionCommands` — translates agent events into actions.
//
// Add a new behavior by:
//   1. Extending `SessionUIState` with the new slice.
//   2. Adding action variants to `SessionUIAction` and reducer cases.
//   3. Exposing a small consumer hook (like `useSessionPreviewUI`) for the UI.
//   4. Wiring the agent event in `useSessionCommands` via `dispatch`.

export interface SessionPreviewTab {
	id: string;
	path: string;
	reloadNonce: number;
}

interface PreviewUIState {
	open: boolean;
	path: string;
	reloadNonce: number;
	tabs: SessionPreviewTab[];
	activeTabId: string;
	nextTabIndex: number;
}

export interface SessionUIState {
	preview: PreviewUIState;
}

export type SessionUIAction =
	| { type: 'preview/set-open'; value: boolean }
	| { type: 'preview/toggle' }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/open-tab'; path?: string }
	| { type: 'preview/close-tab'; tabId: string }
	| { type: 'preview/select-tab'; tabId: string }
	| { type: 'preview/update-active-tab-path'; path: string };

const INITIAL_PREVIEW_TAB_ID = 'preview-tab-1';
const INITIAL_PREVIEW_PATH = '/';

const INITIAL_STATE: SessionUIState = {
	preview: {
		open: false,
		path: INITIAL_PREVIEW_PATH,
		reloadNonce: 0,
		tabs: [ { id: INITIAL_PREVIEW_TAB_ID, path: INITIAL_PREVIEW_PATH, reloadNonce: 0 } ],
		activeTabId: INITIAL_PREVIEW_TAB_ID,
		nextTabIndex: 2,
	},
};

function reducer( state: SessionUIState, action: SessionUIAction ): SessionUIState {
	switch ( action.type ) {
		case 'preview/set-open':
			return state.preview.open === action.value
				? state
				: { ...state, preview: { ...state.preview, open: action.value } };
		case 'preview/toggle':
			return { ...state, preview: { ...state.preview, open: ! state.preview.open } };
		case 'preview/navigate': {
			const activeTabIndex = state.preview.tabs.findIndex(
				( tab ) => tab.id === state.preview.activeTabId
			);
			if ( activeTabIndex === -1 ) {
				const id = `preview-tab-${ state.preview.nextTabIndex }`;
				const tab = { id, path: action.path, reloadNonce: 1 };
				return {
					...state,
					preview: {
						...state.preview,
						path: action.path,
						reloadNonce: tab.reloadNonce,
						tabs: [ ...state.preview.tabs, tab ],
						activeTabId: id,
						nextTabIndex: state.preview.nextTabIndex + 1,
						open: true,
					},
				};
			}
			const activeTab = state.preview.tabs[ activeTabIndex ];
			const reloadNonce = activeTab.reloadNonce + 1;
			const tabs = state.preview.tabs.map( ( tab, index ) =>
				index === activeTabIndex ? { ...tab, path: action.path, reloadNonce } : tab
			);
			return {
				...state,
				preview: {
					...state.preview,
					path: action.path,
					reloadNonce,
					tabs,
					open: true,
				},
			};
		}
		case 'preview/open-tab': {
			const path = typeof action.path === 'string' ? action.path : INITIAL_PREVIEW_PATH;
			const id = `preview-tab-${ state.preview.nextTabIndex }`;
			const tab = { id, path, reloadNonce: 0 };
			return {
				...state,
				preview: {
					...state.preview,
					path,
					reloadNonce: tab.reloadNonce,
					tabs: [ ...state.preview.tabs, tab ],
					activeTabId: id,
					nextTabIndex: state.preview.nextTabIndex + 1,
					open: true,
				},
			};
		}
		case 'preview/close-tab': {
			const closedTabIndex = state.preview.tabs.findIndex( ( tab ) => tab.id === action.tabId );
			if ( closedTabIndex === -1 ) {
				return state;
			}

			const tabs = state.preview.tabs.filter( ( tab ) => tab.id !== action.tabId );
			if ( tabs.length === 0 ) {
				const id = `preview-tab-${ state.preview.nextTabIndex }`;
				const tab = { id, path: INITIAL_PREVIEW_PATH, reloadNonce: 0 };
				return {
					...state,
					preview: {
						...state.preview,
						path: tab.path,
						reloadNonce: tab.reloadNonce,
						tabs: [ tab ],
						activeTabId: id,
						nextTabIndex: state.preview.nextTabIndex + 1,
						open: true,
					},
				};
			}

			if ( action.tabId !== state.preview.activeTabId ) {
				return { ...state, preview: { ...state.preview, tabs } };
			}

			const nextActiveTab = tabs[ Math.min( closedTabIndex, tabs.length - 1 ) ];
			return {
				...state,
				preview: {
					...state.preview,
					path: nextActiveTab.path,
					reloadNonce: nextActiveTab.reloadNonce,
					tabs,
					activeTabId: nextActiveTab.id,
					open: true,
				},
			};
		}
		case 'preview/select-tab': {
			const tab = state.preview.tabs.find( ( candidate ) => candidate.id === action.tabId );
			if ( ! tab ) {
				return state;
			}
			return {
				...state,
				preview: {
					...state.preview,
					path: tab.path,
					reloadNonce: tab.reloadNonce,
					activeTabId: tab.id,
					open: true,
				},
			};
		}
		case 'preview/update-active-tab-path': {
			const activeTabIndex = state.preview.tabs.findIndex(
				( tab ) => tab.id === state.preview.activeTabId
			);
			if ( activeTabIndex === -1 ) {
				return state;
			}
			const activeTab = state.preview.tabs[ activeTabIndex ];
			if ( activeTab.path === action.path ) {
				return state;
			}
			const tabs = state.preview.tabs.map( ( tab, index ) =>
				index === activeTabIndex ? { ...tab, path: action.path } : tab
			);
			return {
				...state,
				preview: {
					...state.preview,
					path: action.path,
					tabs,
				},
			};
		}
	}
}

// Split contexts so that hooks which only need to dispatch (like
// `useSessionCommands`) don't re-run on every state change.
const SessionUIStateContext = createContext< SessionUIState | null >( null );
const SessionUIDispatchContext = createContext< Dispatch< SessionUIAction > | null >( null );
const SessionUIPreviewAnnotationsContext = createContext< MutableRefObject<
	( ( annotations: Annotation[] ) => void ) | undefined
> | null >( null );

export function SessionUIProvider( { children }: { children: ReactNode } ) {
	const parentState = useContext( SessionUIStateContext );
	const parentDispatch = useContext( SessionUIDispatchContext );
	if ( parentState && parentDispatch ) {
		return <>{ children }</>;
	}
	return <SessionUIProviderRoot>{ children }</SessionUIProviderRoot>;
}

function SessionUIProviderRoot( { children }: { children: ReactNode } ) {
	const [ state, dispatch ] = useReducer( reducer, INITIAL_STATE );
	const previewAnnotationsRef = useRef< ( ( annotations: Annotation[] ) => void ) | undefined >(
		undefined
	);
	return (
		<SessionUIDispatchContext.Provider value={ dispatch }>
			<SessionUIPreviewAnnotationsContext.Provider value={ previewAnnotationsRef }>
				<SessionUIStateContext.Provider value={ state }>
					{ children }
				</SessionUIStateContext.Provider>
			</SessionUIPreviewAnnotationsContext.Provider>
		</SessionUIDispatchContext.Provider>
	);
}

function useSessionUIState(): SessionUIState {
	const value = useContext( SessionUIStateContext );
	if ( ! value ) {
		throw new Error( 'useSessionUIState must be used within a SessionUIProvider' );
	}
	return value;
}

export function useSessionUIDispatch(): Dispatch< SessionUIAction > {
	const value = useContext( SessionUIDispatchContext );
	if ( ! value ) {
		throw new Error( 'useSessionUIDispatch must be used within a SessionUIProvider' );
	}
	return value;
}

export interface SessionPreviewUI {
	readonly open: boolean;
	readonly path: string;
	readonly reloadNonce: number;
	readonly tabs: readonly SessionPreviewTab[];
	readonly activeTabId: string;
	setOpen: ( value: boolean ) => void;
	toggle: () => void;
	navigate: ( path: string ) => void;
	openTab: ( path?: string ) => void;
	closeTab: ( tabId: string ) => void;
	selectTab: ( tabId: string ) => void;
	updateActiveTabPath: ( path: string ) => void;
}

export function useSessionPreviewUI(): SessionPreviewUI {
	const state = useSessionUIState();
	const dispatch = useSessionUIDispatch();
	const setOpen = useCallback(
		( value: boolean ) => dispatch( { type: 'preview/set-open', value } ),
		[ dispatch ]
	);
	const toggle = useCallback( () => dispatch( { type: 'preview/toggle' } ), [ dispatch ] );
	const navigate = useCallback(
		( path: string ) => dispatch( { type: 'preview/navigate', path } ),
		[ dispatch ]
	);
	const openTab = useCallback(
		( path?: string ) => dispatch( { type: 'preview/open-tab', path } ),
		[ dispatch ]
	);
	const closeTab = useCallback(
		( tabId: string ) => dispatch( { type: 'preview/close-tab', tabId } ),
		[ dispatch ]
	);
	const selectTab = useCallback(
		( tabId: string ) => dispatch( { type: 'preview/select-tab', tabId } ),
		[ dispatch ]
	);
	const updateActiveTabPath = useCallback(
		( path: string ) => dispatch( { type: 'preview/update-active-tab-path', path } ),
		[ dispatch ]
	);
	return useMemo(
		() => ( {
			open: state.preview.open,
			path: state.preview.path,
			reloadNonce: state.preview.reloadNonce,
			tabs: state.preview.tabs,
			activeTabId: state.preview.activeTabId,
			setOpen,
			toggle,
			navigate,
			openTab,
			closeTab,
			selectTab,
			updateActiveTabPath,
		} ),
		[
			state.preview.open,
			state.preview.path,
			state.preview.reloadNonce,
			state.preview.tabs,
			state.preview.activeTabId,
			setOpen,
			toggle,
			navigate,
			openTab,
			closeTab,
			selectTab,
			updateActiveTabPath,
		]
	);
}

export function useSessionPreviewAnnotations(
	onAnnotationsDone: ( annotations: Annotation[] ) => void,
	enabled: boolean
): void {
	const ref = useContext( SessionUIPreviewAnnotationsContext );
	if ( ! ref ) {
		throw new Error( 'useSessionPreviewAnnotations must be used within a SessionUIProvider' );
	}
	useEffect( () => {
		if ( ! enabled ) {
			return;
		}
		ref.current = onAnnotationsDone;
		return () => {
			if ( ref.current === onAnnotationsDone ) {
				ref.current = undefined;
			}
		};
	}, [ enabled, onAnnotationsDone, ref ] );
}

export function useSessionPreviewAnnotationsHandler(): ( annotations: Annotation[] ) => void {
	const ref = useContext( SessionUIPreviewAnnotationsContext );
	if ( ! ref ) {
		throw new Error(
			'useSessionPreviewAnnotationsHandler must be used within a SessionUIProvider'
		);
	}
	return useCallback( ( annotations: Annotation[] ) => ref.current?.( annotations ), [ ref ] );
}
