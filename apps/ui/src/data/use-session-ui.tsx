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
	getStoredSitePreviewVisibility,
	storeSitePreviewVisibility,
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
	openBySiteId: Record< string, boolean >;
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
	// A just-started site whose first page is still loading.
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
	| { type: 'preview/set-open'; value: boolean; instant?: boolean; siteId?: string }
	| { type: 'preview/toggle' }
	| { type: 'preview/set-chat-hidden'; value: boolean; siteId?: string }
	| { type: 'preview/reset-layout' }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/reload' }
	| { type: 'preview/update-path'; path: string }
	| { type: 'preview/set-site'; siteId: string; running?: boolean }
	| { type: 'preview/set-revealing'; siteId: string; value: boolean };

const INITIAL_STATE: SessionUIState = {
	preview: {
		open: true,
		openBySiteId: {},
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
			const siteId = action.siteId ?? state.preview.siteId;
			if ( siteId && siteId !== state.preview.siteId ) {
				return {
					...state,
					preview: {
						...state.preview,
						openBySiteId: { ...state.preview.openBySiteId, [ siteId ]: action.value },
					},
				};
			}
			if (
				state.preview.open === action.value &&
				( ! siteId || state.preview.openBySiteId[ siteId ] === action.value ) &&
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
					openBySiteId: {},
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
					open: state.preview.openBySiteId[ action.siteId ] ?? action.running ?? false,
					instant: true,
					chatHiddenBySiteId: {
						...state.preview.chatHiddenBySiteId,
						[ action.siteId ]:
							state.preview.chatHiddenBySiteId[ action.siteId ] ??
							( state.preview.siteId === null && ! Object.keys( state.preview.openBySiteId ).length
								? state.preview.layout.chatHidden
								: false ),
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
		openBySiteId: preview.siteId
			? { ...preview.openBySiteId, [ preview.siteId ]: preview.open }
			: preview.openBySiteId,
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
			openBySiteId: getStoredSitePreviewVisibility(),
			layout: getStoredPreviewLayout(),
			chatHiddenBySiteId: getStoredSiteChatVisibility(),
		},
	} ) );
	useEffect( () => {
		storePreviewLayout( state.preview.layout );
	}, [ state.preview.layout ] );
	useEffect( () => {
		storeSitePreviewVisibility( state.preview.openBySiteId );
	}, [ state.preview.openBySiteId ] );
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
	readonly openBySiteId: Record< string, boolean >;
	readonly instant: boolean;
	readonly chatHidden: boolean;
	readonly chatHiddenBySiteId: Record< string, boolean >;
	readonly path: string;
	readonly reloadNonce: number;
	readonly siteId: string | null;
	readonly pathsBySiteId: Record< string, string >;
	readonly revealingSiteId: string | null;
	setOpen: ( value: boolean, options?: { instant?: boolean; siteId?: string } ) => void;
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
		( value: boolean, { instant = false, siteId }: { instant?: boolean; siteId?: string } = {} ) =>
			dispatch?.( { type: 'preview/set-open', value, instant, siteId } ),
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
		( siteId: string, options?: { running: boolean } ) =>
			dispatch?.( { type: 'preview/set-site', siteId, running: options?.running } ),
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
			openBySiteId: state.preview.openBySiteId,
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
