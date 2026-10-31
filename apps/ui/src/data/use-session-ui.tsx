import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	type Dispatch,
	type ReactNode,
} from 'react';
import {
	getStoredSiteChatVisibility,
	getStoredPreviewLayout,
	storePreviewLayout,
	type PreviewLayout,
	storeSiteChatVisibility,
	PANEL_WIDTHS_RESET_EVENT,
} from '@/data/resizable-panels';

// App-wide UI store (mounted once in the root route, shared by every route
// and dialog under it). Holds the slices of UI state that the chat agent
// can influence (the preview panel) so that components can read/update them
// while a separate bridge — `useSessionCommands` — translates agent events
// into actions.
//
// Add a new behavior by:
//   1. Extending `SessionUIState` with the new slice.
//   2. Adding action variants to `SessionUIAction` and reducer cases.
//   3. Exposing a small consumer hook (like `useSessionPreviewUI`) for the UI.
//   4. Wiring the agent event in `useSessionCommands` via `dispatch`.

interface PreviewUIState {
	open: boolean;
	instant: boolean;
	layout: PreviewLayout;
	// The chat pane is hidden and the preview takes its place; the sidebar stays.
	// Only applied while the preview is open.
	chatHiddenBySiteId: Record< string, boolean >;
	reloadNonce: number;
	// Currently previewed site.
	siteId: string | null;
	// Last visited path per site, so switching back restores it. In-memory only.
	pathsBySiteId: Record< string, string >;
	// A just-started site whose first page is still loading: the chat keeps its
	// loading stage and the preview stays shut until the page arrives.
	revealingSiteId: string | null;
}

// The path a site's preview shows: its last visited path, or home.
export function pathForSite(
	pathsBySiteId: Record< string, string >,
	siteId: string | null | undefined
): string {
	return siteId ? pathsBySiteId[ siteId ] ?? '/' : '/';
}

interface SessionUIState {
	preview: PreviewUIState;
}

type SessionUIAction =
	| { type: 'preview/set-open'; value: boolean; instant?: boolean }
	| { type: 'preview/toggle' }
	| { type: 'preview/set-chat-hidden'; value: boolean; siteId?: string }
	| { type: 'preview/reset-layout' }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/reload' }
	| { type: 'preview/update-path'; path: string }
	| { type: 'preview/set-site'; siteId: string }
	| { type: 'preview/set-revealing'; siteId: string; value: boolean };

const INITIAL_STATE: SessionUIState = {
	preview: {
		open: true,
		instant: false,
		layout: { open: true, chatHidden: false },
		chatHiddenBySiteId: {},
		reloadNonce: 0,
		siteId: null,
		pathsBySiteId: {},
		revealingSiteId: null,
	},
};

function reducer( state: SessionUIState, action: SessionUIAction ): SessionUIState {
	switch ( action.type ) {
		case 'preview/set-open': {
			if (
				state.preview.open === action.value &&
				state.preview.instant === ( action.instant ?? false )
			)
				return state;
			return {
				...state,
				preview: rememberLayout( {
					...state.preview,
					open: action.value,
					instant: action.instant ?? false,
				} ),
			};
		}
		case 'preview/toggle':
			return {
				...state,
				preview: rememberLayout( {
					...state.preview,
					open: ! state.preview.open,
					instant: false,
				} ),
			};
		case 'preview/set-chat-hidden': {
			const siteId = action.siteId ?? state.preview.siteId;
			if ( ! siteId || ( state.preview.chatHiddenBySiteId[ siteId ] ?? false ) === action.value )
				return state;
			const preview = {
				...state.preview,
				chatHiddenBySiteId: { ...state.preview.chatHiddenBySiteId, [ siteId ]: action.value },
			};
			return {
				...state,
				preview: siteId === preview.siteId ? rememberLayout( preview ) : preview,
			};
		}
		case 'preview/reset-layout':
			return {
				...state,
				preview: {
					...state.preview,
					open: true,
					instant: false,
					chatHiddenBySiteId: {},
					layout: { open: true, chatHidden: false },
				},
			};
		case 'preview/navigate':
			return {
				...state,
				preview: rememberLayout( {
					...state.preview,
					pathsBySiteId: rememberPath( state.preview, action.path ),
					reloadNonce: state.preview.reloadNonce + 1,
					open: true,
				} ),
			};
		case 'preview/reload':
			// Reload in place, without opening a closed panel.
			return {
				...state,
				preview: { ...state.preview, reloadNonce: state.preview.reloadNonce + 1 },
			};
		case 'preview/update-path': {
			const pathsBySiteId = rememberPath( state.preview, action.path );
			return pathsBySiteId === state.preview.pathsBySiteId
				? state
				: { ...state, preview: { ...state.preview, pathsBySiteId } };
		}
		case 'preview/set-site': {
			if ( state.preview.siteId === action.siteId ) return state;
			return {
				...state,
				preview: {
					...state.preview,
					siteId: action.siteId,
					instant: true,
					chatHiddenBySiteId: {
						...state.preview.chatHiddenBySiteId,
						[ action.siteId ]: state.preview.layout.chatHidden,
					},
				},
			};
		}
		case 'preview/set-revealing': {
			const revealingSiteId = action.value
				? action.siteId
				: state.preview.revealingSiteId === action.siteId
				? null
				: state.preview.revealingSiteId;
			return revealingSiteId === state.preview.revealingSiteId
				? state
				: { ...state, preview: { ...state.preview, revealingSiteId } };
		}
	}
}

function rememberLayout( preview: PreviewUIState ): PreviewUIState {
	return {
		...preview,
		layout: {
			open: preview.open,
			chatHidden: preview.chatHiddenBySiteId[ preview.siteId ?? '' ] ?? preview.layout.chatHidden,
		},
	};
}

function rememberPath( preview: PreviewUIState, path: string ): Record< string, string > {
	if ( ! preview.siteId || preview.pathsBySiteId[ preview.siteId ] === path ) {
		return preview.pathsBySiteId;
	}
	return { ...preview.pathsBySiteId, [ preview.siteId ]: path };
}

// Split contexts so that hooks which only need to dispatch (like
// `useSessionCommands`) don't re-run on every state change.
const SessionUIStateContext = createContext< SessionUIState | null >( null );
const SessionUIDispatchContext = createContext< Dispatch< SessionUIAction > | null >( null );

export function SessionUIProvider( { children }: { children: ReactNode } ) {
	// Views mount their own provider so they stay usable standalone (e.g. in
	// tests), but when one is already mounted above — the root route —
	// the nested provider reuses it instead of forking the state.
	const parentState = useContext( SessionUIStateContext );
	const parentDispatch = useContext( SessionUIDispatchContext );
	if ( parentState && parentDispatch ) {
		return <>{ children }</>;
	}
	return <SessionUIProviderRoot>{ children }</SessionUIProviderRoot>;
}

function SessionUIProviderRoot( { children }: { children: ReactNode } ) {
	const [ state, dispatch ] = useReducer( reducer, INITIAL_STATE, ( initial ) => ( {
		...initial,
		preview: {
			...initial.preview,
			open: getStoredPreviewLayout().open,
			layout: getStoredPreviewLayout(),
			chatHiddenBySiteId: getStoredSiteChatVisibility(),
		},
	} ) );
	useEffect( () => {
		storePreviewLayout( state.preview.layout );
	}, [ state.preview.layout ] );
	useEffect( () => {
		storeSiteChatVisibility( state.preview.chatHiddenBySiteId );
	}, [ state.preview.chatHiddenBySiteId ] );
	useEffect( () => {
		const reset = () => dispatch( { type: 'preview/reset-layout' } );
		window.addEventListener( PANEL_WIDTHS_RESET_EVENT, reset );
		return () => window.removeEventListener( PANEL_WIDTHS_RESET_EVENT, reset );
	}, [] );

	return (
		<SessionUIDispatchContext.Provider value={ dispatch }>
			<SessionUIStateContext.Provider value={ state }>{ children }</SessionUIStateContext.Provider>
		</SessionUIDispatchContext.Provider>
	);
}

export function useSessionUIDispatch(): Dispatch< SessionUIAction > {
	const value = useContext( SessionUIDispatchContext );
	if ( ! value ) {
		throw new Error( 'useSessionUIDispatch must be used within a SessionUIProvider' );
	}
	return value;
}

interface SessionPreviewUI {
	readonly open: boolean;
	readonly instant: boolean;
	readonly chatHidden: boolean;
	readonly chatHiddenBySiteId: Record< string, boolean >;
	readonly path: string;
	readonly reloadNonce: number;
	readonly siteId: string | null;
	readonly pathsBySiteId: Record< string, string >;
	readonly revealingSiteId: string | null;
	setOpen: ( value: boolean, options?: { instant?: boolean } ) => void;
	toggle: () => void;
	setChatHidden: ( value: boolean, siteId?: string ) => void;
	// Opens the panel on `path` and reloads it, like an agent-driven navigation.
	navigate: ( path: string ) => void;
	updatePath: ( path: string ) => void;
	setSite: ( siteId: string, options?: { running: boolean } ) => void;
	setRevealing: ( siteId: string, value: boolean ) => void;
}

// Like `useSessionPreviewUI`, but returns null when no SessionUIProvider is
// mounted (standalone views, tests), so callers can fall
// back to non-preview behavior (e.g. opening the external browser).
export function useOptionalSessionPreviewUI(): SessionPreviewUI | null {
	const state = useContext( SessionUIStateContext );
	const dispatch = useContext( SessionUIDispatchContext );
	const setOpen = useCallback(
		( value: boolean, { instant = false }: { instant?: boolean } = {} ) =>
			dispatch?.( { type: 'preview/set-open', value, instant } ),
		[ dispatch ]
	);
	const toggle = useCallback( () => dispatch?.( { type: 'preview/toggle' } ), [ dispatch ] );
	const setChatHidden = useCallback(
		( value: boolean, siteId?: string ) =>
			dispatch?.( { type: 'preview/set-chat-hidden', value, siteId } ),
		[ dispatch ]
	);
	const navigate = useCallback(
		( path: string ) => dispatch?.( { type: 'preview/navigate', path } ),
		[ dispatch ]
	);
	const updatePath = useCallback(
		( path: string ) => dispatch?.( { type: 'preview/update-path', path } ),
		[ dispatch ]
	);
	const setSite = useCallback(
		( siteId: string ) => dispatch?.( { type: 'preview/set-site', siteId } ),
		[ dispatch ]
	);
	const setRevealing = useCallback(
		( siteId: string, value: boolean ) =>
			dispatch?.( { type: 'preview/set-revealing', siteId, value } ),
		[ dispatch ]
	);
	return useMemo( () => {
		if ( ! state || ! dispatch ) {
			return null;
		}
		return {
			open: state.preview.open,
			instant: state.preview.instant,
			chatHidden:
				state.preview.open &&
				( state.preview.chatHiddenBySiteId[ state.preview.siteId ?? '' ] ?? false ),
			chatHiddenBySiteId: state.preview.chatHiddenBySiteId,
			path: pathForSite( state.preview.pathsBySiteId, state.preview.siteId ),
			reloadNonce: state.preview.reloadNonce,
			siteId: state.preview.siteId,
			pathsBySiteId: state.preview.pathsBySiteId,
			revealingSiteId: state.preview.revealingSiteId,
			setOpen,
			toggle,
			setChatHidden,
			navigate,
			updatePath,
			setSite,
			setRevealing,
		};
	}, [
		state,
		dispatch,
		setOpen,
		toggle,
		setChatHidden,
		navigate,
		updatePath,
		setSite,
		setRevealing,
	] );
}

export function useSessionPreviewUI(): SessionPreviewUI {
	const ui = useOptionalSessionPreviewUI();
	if ( ! ui ) {
		throw new Error( 'useSessionPreviewUI must be used within a SessionUIProvider' );
	}
	return ui;
}
