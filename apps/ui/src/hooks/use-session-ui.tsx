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
import { useConnector } from '@/data/core';
import type { Annotation } from '@/components/site-preview/types';

// Dashboard-scoped UI store (mounted once in the dashboard layout, shared by
// every route under it). Holds the slices of UI state that the chat agent
// can influence (preview panel today; future: composer, conversation pane,
// modals, etc.) so that components can read/update them while a separate
// bridge — `useSessionCommands` — translates agent events into actions.
//
// Add a new behavior by:
//   1. Extending `SessionUIState` with the new slice.
//   2. Adding action variants to `SessionUIAction` and reducer cases.
//   3. Exposing a small consumer hook (like `useSessionPreviewUI`) for the UI.
//   4. Wiring the agent event in `useSessionCommands` via `dispatch`.

interface PreviewUIState {
	open: boolean;
	surface: 'site' | 'review';
	// Full preview: the preview fills the window (sidebar and chat hidden).
	// Only meaningful while `open`; closing the panel always clears it.
	fullscreen: boolean;
	reloadNonce: number;
	// Currently previewed site.
	siteId: string | null;
	// Last visited path per site, so switching back restores it. In-memory only.
	pathsBySiteId: Record< string, string >;
}

// The path a site's preview shows: its last visited path, or home.
export function pathForSite(
	pathsBySiteId: Record< string, string >,
	siteId: string | null | undefined
): string {
	return siteId ? pathsBySiteId[ siteId ] ?? '/' : '/';
}

export interface SessionUIState {
	preview: PreviewUIState;
}

export type SessionUIAction =
	| { type: 'preview/set-open'; value: boolean }
	| { type: 'preview/toggle' }
	| { type: 'preview/show-review' }
	| { type: 'preview/show-site' }
	| { type: 'preview/set-fullscreen'; value: boolean }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/reload' }
	| { type: 'preview/update-path'; path: string }
	| { type: 'preview/set-site'; siteId: string };

const INITIAL_STATE: SessionUIState = {
	preview: {
		open: true,
		surface: 'site',
		fullscreen: false,
		reloadNonce: 0,
		siteId: null,
		pathsBySiteId: {},
	},
};

function reducer( state: SessionUIState, action: SessionUIAction ): SessionUIState {
	switch ( action.type ) {
		case 'preview/set-open':
			return state.preview.open === action.value
				? state
				: {
						...state,
						// Closing the panel leaves full preview; reopening starts split.
						preview: {
							...state.preview,
							open: action.value,
							fullscreen: action.value && state.preview.fullscreen,
						},
				  };
		case 'preview/toggle':
			return {
				...state,
				preview: { ...state.preview, open: ! state.preview.open, fullscreen: false },
			};
		case 'preview/show-review':
			return {
				...state,
				preview: { ...state.preview, open: true, surface: 'review' },
			};
		case 'preview/show-site':
			return state.preview.surface === 'site'
				? state
				: { ...state, preview: { ...state.preview, surface: 'site' } };
		case 'preview/set-fullscreen':
			return state.preview.fullscreen === action.value
				? state
				: {
						...state,
						preview: {
							...state.preview,
							fullscreen: action.value,
							// Entering full preview reveals the panel it expands.
							open: action.value || state.preview.open,
						},
				  };
		case 'preview/navigate':
			return {
				...state,
				preview: {
					...state.preview,
					pathsBySiteId: rememberPath( state.preview, action.path ),
					reloadNonce: state.preview.reloadNonce + 1,
					open: true,
				},
			};
		case 'preview/reload':
			// Reload the current path in place (bump the nonce). Reveal the
			// panel so the agent-triggered refresh is actually visible.
			return {
				...state,
				preview: {
					...state.preview,
					reloadNonce: state.preview.reloadNonce + 1,
					open: true,
				},
			};
		case 'preview/update-path': {
			const pathsBySiteId = rememberPath( state.preview, action.path );
			return pathsBySiteId === state.preview.pathsBySiteId
				? state
				: { ...state, preview: { ...state.preview, pathsBySiteId } };
		}
		case 'preview/set-site':
			return state.preview.siteId === action.siteId
				? state
				: { ...state, preview: { ...state.preview, siteId: action.siteId } };
	}
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
// Ref (not state) so registering/unregistering the handler never re-renders
// the tree; the dashboard-level preview reads it lazily on submit.
const SessionUIPreviewAnnotationsContext = createContext< MutableRefObject<
	( ( annotations: Annotation[] ) => void ) | undefined
> | null >( null );

export function SessionUIProvider( { children }: { children: ReactNode } ) {
	// Views mount their own provider so they stay usable standalone (e.g. in
	// tests), but when one is already mounted above — the dashboard layout —
	// the nested provider reuses it instead of forking the state.
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
	const connector = useConnector();
	useEffect( () => {
		return connector.onToggleSitePreview( () => {
			dispatch( { type: 'preview/toggle' } );
		} );
	}, [ connector ] );
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

export function useSessionUIDispatch(): Dispatch< SessionUIAction > {
	const value = useContext( SessionUIDispatchContext );
	if ( ! value ) {
		throw new Error( 'useSessionUIDispatch must be used within a SessionUIProvider' );
	}
	return value;
}

export interface SessionPreviewUI {
	readonly open: boolean;
	readonly surface: 'site' | 'review';
	readonly fullscreen: boolean;
	readonly path: string;
	readonly reloadNonce: number;
	readonly siteId: string | null;
	readonly pathsBySiteId: Record< string, string >;
	setOpen: ( value: boolean ) => void;
	toggle: () => void;
	showReview: () => void;
	showSite: () => void;
	setFullscreen: ( value: boolean ) => void;
	updatePath: ( path: string ) => void;
	setSite: ( siteId: string ) => void;
}

// Like `useSessionPreviewUI`, but usable outside the dashboard layout —
// returns null when no SessionUIProvider is mounted, so callers can fall
// back to non-preview behavior (e.g. opening the external browser).
export function useOptionalSessionPreviewUI(): SessionPreviewUI | null {
	const state = useContext( SessionUIStateContext );
	const dispatch = useContext( SessionUIDispatchContext );
	const setOpen = useCallback(
		( value: boolean ) => dispatch?.( { type: 'preview/set-open', value } ),
		[ dispatch ]
	);
	const toggle = useCallback( () => dispatch?.( { type: 'preview/toggle' } ), [ dispatch ] );
	const showReview = useCallback(
		() => dispatch?.( { type: 'preview/show-review' } ),
		[ dispatch ]
	);
	const showSite = useCallback( () => dispatch?.( { type: 'preview/show-site' } ), [ dispatch ] );
	const setFullscreen = useCallback(
		( value: boolean ) => dispatch?.( { type: 'preview/set-fullscreen', value } ),
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
	return useMemo( () => {
		if ( ! state || ! dispatch ) {
			return null;
		}
		return {
			open: state.preview.open,
			surface: state.preview.surface,
			fullscreen: state.preview.fullscreen,
			path: pathForSite( state.preview.pathsBySiteId, state.preview.siteId ),
			reloadNonce: state.preview.reloadNonce,
			siteId: state.preview.siteId,
			pathsBySiteId: state.preview.pathsBySiteId,
			setOpen,
			toggle,
			showReview,
			showSite,
			setFullscreen,
			updatePath,
			setSite,
		};
	}, [
		state,
		dispatch,
		setOpen,
		toggle,
		showReview,
		showSite,
		setFullscreen,
		updatePath,
		setSite,
	] );
}

export function useSessionPreviewUI(): SessionPreviewUI {
	const ui = useOptionalSessionPreviewUI();
	if ( ! ui ) {
		throw new Error( 'useSessionPreviewUI must be used within a SessionUIProvider' );
	}
	return ui;
}

// Registers the on-screen session's annotations handler (its "send to chat")
// with the shared store, so the dashboard-level preview can submit
// annotations to whichever session is currently displayed.
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
