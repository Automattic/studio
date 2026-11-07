import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { QueryClientContext } from '@tanstack/react-query';
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
import { useConnector } from '@/data/core';
import { getDefaultPanelLayout, PANEL_WIDTHS_RESET_EVENT } from '@/data/resizable-panels';
import { isSiteRestarting } from '@/data/site-restarts';

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

// The path a site's preview shows: its last visited path, or `home`.
export function pathForSite(
	pathsBySiteId: Record< string, string >,
	siteId: string | null | undefined,
	home = '/'
): string {
	return siteId ? pathsBySiteId[ siteId ] ?? home : home;
}

interface SessionUIState {
	preview: PreviewUIState;
}

type SessionUIAction =
	| { type: 'panel/set-open'; value: boolean; instant?: boolean; siteId?: string }
	| { type: 'panel/toggle' }
	| { type: 'panel/set-fullscreen'; value: boolean; siteId?: string; instant?: boolean }
	| { type: 'panel/reset-layout' }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/reload' }
	| { type: 'preview/update-path'; path: string }
	| { type: 'preview/reset-site-path'; siteId: string }
	| { type: 'preview/set-site'; siteId: string; running?: boolean }
	| { type: 'preview/set-revealing'; siteId: string; value: boolean };

const INITIAL_STATE: SessionUIState = {
	preview: {
		open: getDefaultPanelLayout().open,
		openBySiteId: {},
		instant: false,
		chatHiddenBySiteId: {},
		reloadNonce: 0,
		siteId: null,
		pathsBySiteId: {},
		revealingSiteId: null,
	},
};

function reducer( state: SessionUIState, action: SessionUIAction ): SessionUIState {
	switch ( action.type ) {
		case 'panel/set-open': {
			const siteId = action.siteId ?? state.preview.siteId;
			if ( siteId && siteId !== state.preview.siteId ) {
				return {
					...state,
					preview: {
						...state.preview,
						openBySiteId: { ...state.preview.openBySiteId, [ siteId ]: action.value },
						chatHiddenBySiteId: action.value
							? state.preview.chatHiddenBySiteId
							: { ...state.preview.chatHiddenBySiteId, [ siteId ]: false },
					},
				};
			}
			if (
				state.preview.open === action.value &&
				( action.value || ! siteId || ! state.preview.chatHiddenBySiteId[ siteId ] ) &&
				( ! siteId || state.preview.openBySiteId[ siteId ] === action.value ) &&
				state.preview.instant === ( action.instant ?? false )
			)
				return state;
			return {
				...state,
				preview: rememberVisibility( {
					...state.preview,
					open: action.value,
					chatHiddenBySiteId:
						! action.value && siteId
							? { ...state.preview.chatHiddenBySiteId, [ siteId ]: false }
							: state.preview.chatHiddenBySiteId,
					instant: action.instant ?? false,
				} ),
			};
		}
		case 'panel/toggle':
			return reducer( state, { type: 'panel/set-open', value: ! state.preview.open } );
		case 'panel/set-fullscreen': {
			const siteId = action.siteId ?? state.preview.siteId;
			if ( ! siteId || ( state.preview.chatHiddenBySiteId[ siteId ] ?? false ) === action.value )
				return state;
			const preview = {
				...state.preview,
				instant: siteId === state.preview.siteId ? action.instant ?? false : state.preview.instant,
				chatHiddenBySiteId: { ...state.preview.chatHiddenBySiteId, [ siteId ]: action.value },
			};
			return {
				...state,
				preview: siteId === preview.siteId ? rememberVisibility( preview ) : preview,
			};
		}
		case 'panel/reset-layout':
			return {
				...state,
				preview: {
					...state.preview,
					siteId: null,
					open: getDefaultPanelLayout().open,
					instant: false,
					openBySiteId: {},
					chatHiddenBySiteId: {},
				},
			};
		case 'preview/navigate':
			return {
				...state,
				preview: rememberVisibility( {
					...state.preview,
					pathsBySiteId: rememberPath( state.preview, action.path ),
					reloadNonce: state.preview.reloadNonce + 1,
					open: true,
					instant: false,
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
		case 'preview/reset-site-path':
			return {
				...state,
				preview: {
					...state.preview,
					pathsBySiteId: { ...state.preview.pathsBySiteId, [ action.siteId ]: '/' },
				},
			};

		case 'preview/set-site': {
			if ( state.preview.siteId === action.siteId ) return state;
			return {
				...state,
				preview: {
					...state.preview,
					siteId: action.siteId,
					open:
						state.preview.openBySiteId[ action.siteId ] ??
						getDefaultPanelLayout( action.running ?? false ).open,
					instant: true,
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

function rememberVisibility( preview: PreviewUIState ): PreviewUIState {
	return {
		...preview,
		openBySiteId: preview.siteId
			? { ...preview.openBySiteId, [ preview.siteId ]: preview.open }
			: preview.openBySiteId,
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
	const connector = useConnector();
	const queryClient = useContext( QueryClientContext );
	const [ state, dispatch ] = useReducer( reducer, INITIAL_STATE );
	useEffect( () => {
		const reset = () => dispatch( { type: 'panel/reset-layout' } );
		window.addEventListener( PANEL_WIDTHS_RESET_EVENT, reset );
		return () => window.removeEventListener( PANEL_WIDTHS_RESET_EVENT, reset );
	}, [] );

	useEffect(
		() =>
			connector.onSiteEvent( ( event ) => {
				if (
					event.event === SITE_EVENTS.UPDATED &&
					event.running === false &&
					! isSiteRestarting( queryClient, event.siteId )
				) {
					dispatch( { type: 'preview/reset-site-path', siteId: event.siteId } );
				}
			} ),
		[ connector, queryClient ]
	);

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
	setChatHidden: ( value: boolean, siteId?: string, options?: { instant?: boolean } ) => void;
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
			dispatch?.( { type: 'panel/set-open', value, instant, siteId } ),
		[ dispatch ]
	);
	const toggle = useCallback( () => dispatch?.( { type: 'panel/toggle' } ), [ dispatch ] );
	const setChatHidden = useCallback(
		( value: boolean, siteId?: string, options?: { instant?: boolean } ) =>
			dispatch?.( { type: 'panel/set-fullscreen', value, siteId, instant: options?.instant } ),
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
