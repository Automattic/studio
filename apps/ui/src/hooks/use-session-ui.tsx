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
import type { PreviewConsoleEntry } from '@/components/site-preview/types';
import type { ComposerClipInput } from '@studio/common/ai/composer-attachments';
import type { ClipMarker } from '@studio/common/inspector/protocol';

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
	// Full preview: the preview fills the window (sidebar and chat hidden).
	// Only meaningful while `open`; closing the panel always clears it.
	fullscreen: boolean;
	path: string;
	reloadNonce: number;
}

interface PreviewConsoleUIState {
	entries: PreviewConsoleEntry[];
}

// The on-screen session's clips, mirrored into the preview's guest page as
// numbered markers (published by the composer, read by the preview).
interface PreviewClipsUIState {
	markers: ClipMarker[];
}

export interface SessionUIState {
	preview: PreviewUIState;
	previewConsole: PreviewConsoleUIState;
	previewClips: PreviewClipsUIState;
}

export type SessionUIAction =
	| { type: 'preview/set-open'; value: boolean }
	| { type: 'preview/toggle' }
	| { type: 'preview/set-fullscreen'; value: boolean }
	| { type: 'preview/toggle-fullscreen' }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/reload' }
	| { type: 'preview/update-path'; path: string }
	| { type: 'preview-console/set-entries'; entries: PreviewConsoleEntry[] }
	| { type: 'preview-clips/set-markers'; markers: ClipMarker[] };

const INITIAL_STATE: SessionUIState = {
	preview: { open: true, fullscreen: false, path: '/', reloadNonce: 0 },
	previewConsole: { entries: [] },
	previewClips: { markers: [] },
};

function reducer( state: SessionUIState, action: SessionUIAction ): SessionUIState {
	switch ( action.type ) {
		case 'preview/set-open':
			return state.preview.open === action.value
				? state
				: {
						...state,
						preview: {
							...state.preview,
							open: action.value,
							// Closing the panel leaves full preview; reopening starts split.
							fullscreen: action.value && state.preview.fullscreen,
						},
				  };
		case 'preview/toggle':
			return {
				...state,
				preview: {
					...state.preview,
					open: ! state.preview.open,
					fullscreen: false,
				},
			};
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
		case 'preview/toggle-fullscreen':
			return {
				...state,
				preview: {
					...state.preview,
					fullscreen: ! state.preview.fullscreen,
					open: ! state.preview.fullscreen || state.preview.open,
				},
			};
		case 'preview/navigate':
			return {
				...state,
				preview: {
					...state.preview,
					path: action.path,
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
		case 'preview/update-path':
			return state.preview.path === action.path
				? state
				: { ...state, preview: { ...state.preview, path: action.path } };
		case 'preview-console/set-entries':
			return state.previewConsole.entries === action.entries
				? state
				: { ...state, previewConsole: { entries: action.entries } };
		case 'preview-clips/set-markers':
			return state.previewClips.markers === action.markers
				? state
				: { ...state, previewClips: { markers: action.markers } };
	}
}

// Split contexts so that hooks which only need to dispatch (like
// `useSessionCommands`) don't re-run on every state change.
const SessionUIStateContext = createContext< SessionUIState | null >( null );
const SessionUIDispatchContext = createContext< Dispatch< SessionUIAction > | null >( null );
/**
 * Everything the preview can do *to* the on-screen session. Registered by
 * the session view while it's displayed; invoked by the dashboard-level
 * preview. The composer owns the clips, so edits round-trip through here.
 */
export interface SessionPreviewClipActions {
	addClip: ( input: ComposerClipInput ) => void | Promise< void >;
	updateClipComment: ( id: string, comment: string ) => void;
	removeClip: ( id: string ) => void;
	appendComposerText: ( text: string ) => void;
}

// Ref (not state) so registering/unregistering the handler never re-renders
// the tree; the dashboard-level preview reads it lazily on use.
const SessionUIPreviewClipActionsContext = createContext< MutableRefObject<
	SessionPreviewClipActions | undefined
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
	const previewClipActionsRef = useRef< SessionPreviewClipActions | undefined >( undefined );
	const connector = useConnector();
	useEffect( () => {
		return connector.onToggleSitePreview( () => {
			dispatch( { type: 'preview/toggle' } );
		} );
	}, [ connector ] );
	return (
		<SessionUIDispatchContext.Provider value={ dispatch }>
			<SessionUIPreviewClipActionsContext.Provider value={ previewClipActionsRef }>
				<SessionUIStateContext.Provider value={ state }>
					{ children }
				</SessionUIStateContext.Provider>
			</SessionUIPreviewClipActionsContext.Provider>
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
	readonly fullscreen: boolean;
	readonly path: string;
	readonly reloadNonce: number;
	setOpen: ( value: boolean ) => void;
	toggle: () => void;
	setFullscreen: ( value: boolean ) => void;
	toggleFullscreen: () => void;
	updatePath: ( path: string ) => void;
}

/**
 * Non-throwing variant for callers that may render outside the dashboard's
 * SessionUIProvider (so they can fall back to another behavior, e.g. opening
 * the browser, when no preview panel exists).
 */
export function useOptionalSessionPreviewUI(): SessionPreviewUI | null {
	const state = useContext( SessionUIStateContext );
	const dispatch = useContext( SessionUIDispatchContext );
	const setOpen = useCallback(
		( value: boolean ) => dispatch?.( { type: 'preview/set-open', value } ),
		[ dispatch ]
	);
	const toggle = useCallback( () => dispatch?.( { type: 'preview/toggle' } ), [ dispatch ] );
	const setFullscreen = useCallback(
		( value: boolean ) => dispatch?.( { type: 'preview/set-fullscreen', value } ),
		[ dispatch ]
	);
	const toggleFullscreen = useCallback(
		() => dispatch?.( { type: 'preview/toggle-fullscreen' } ),
		[ dispatch ]
	);
	const updatePath = useCallback(
		( path: string ) => dispatch?.( { type: 'preview/update-path', path } ),
		[ dispatch ]
	);
	return useMemo( () => {
		if ( ! state || ! dispatch ) {
			return null;
		}
		return {
			open: state.preview.open,
			fullscreen: state.preview.fullscreen,
			path: state.preview.path,
			reloadNonce: state.preview.reloadNonce,
			setOpen,
			toggle,
			setFullscreen,
			toggleFullscreen,
			updatePath,
		};
	}, [ state, dispatch, setOpen, toggle, setFullscreen, toggleFullscreen, updatePath ] );
}

export function useSessionPreviewUI(): SessionPreviewUI {
	const state = useSessionUIState();
	const dispatch = useSessionUIDispatch();
	const setOpen = useCallback(
		( value: boolean ) => dispatch( { type: 'preview/set-open', value } ),
		[ dispatch ]
	);
	const toggle = useCallback( () => dispatch( { type: 'preview/toggle' } ), [ dispatch ] );
	const setFullscreen = useCallback(
		( value: boolean ) => dispatch( { type: 'preview/set-fullscreen', value } ),
		[ dispatch ]
	);
	const toggleFullscreen = useCallback(
		() => dispatch( { type: 'preview/toggle-fullscreen' } ),
		[ dispatch ]
	);
	const updatePath = useCallback(
		( path: string ) => dispatch( { type: 'preview/update-path', path } ),
		[ dispatch ]
	);
	return useMemo(
		() => ( {
			open: state.preview.open,
			fullscreen: state.preview.fullscreen,
			path: state.preview.path,
			reloadNonce: state.preview.reloadNonce,
			setOpen,
			toggle,
			setFullscreen,
			toggleFullscreen,
			updatePath,
		} ),
		[
			state.preview.open,
			state.preview.fullscreen,
			state.preview.path,
			state.preview.reloadNonce,
			setOpen,
			toggle,
			setFullscreen,
			toggleFullscreen,
			updatePath,
		]
	);
}

export interface SessionPreviewConsoleUI {
	readonly entries: PreviewConsoleEntry[];
	setEntries: ( entries: PreviewConsoleEntry[] ) => void;
}

export function useSessionPreviewConsoleUI(): SessionPreviewConsoleUI {
	const state = useSessionUIState();
	const dispatch = useSessionUIDispatch();
	const setEntries = useCallback(
		( entries: PreviewConsoleEntry[] ) =>
			dispatch( { type: 'preview-console/set-entries', entries } ),
		[ dispatch ]
	);
	return useMemo(
		() => ( {
			entries: state.previewConsole.entries,
			setEntries,
		} ),
		[ state.previewConsole.entries, setEntries ]
	);
}

export function useSessionPreviewConsoleEntries(): PreviewConsoleEntry[] {
	return useSessionUIState().previewConsole.entries;
}

// Registers the on-screen session's clip actions with the shared store, so
// the dashboard-level preview routes clips to whichever session is
// currently displayed.
export function useSessionPreviewClips(
	actions: SessionPreviewClipActions,
	enabled: boolean
): void {
	const ref = useContext( SessionUIPreviewClipActionsContext );
	if ( ! ref ) {
		throw new Error( 'useSessionPreviewClips must be used within a SessionUIProvider' );
	}
	useEffect( () => {
		if ( ! enabled ) {
			return;
		}
		ref.current = actions;
		return () => {
			if ( ref.current === actions ) {
				ref.current = undefined;
			}
		};
	}, [ enabled, actions, ref ] );
}

export function useSessionPreviewClipActions(): SessionPreviewClipActions {
	const ref = useContext( SessionUIPreviewClipActionsContext );
	if ( ! ref ) {
		throw new Error( 'useSessionPreviewClipActions must be used within a SessionUIProvider' );
	}
	return useMemo(
		() => ( {
			addClip: async ( input: ComposerClipInput ) => {
				await ref.current?.addClip( input );
			},
			updateClipComment: ( id: string, comment: string ) =>
				ref.current?.updateClipComment( id, comment ),
			removeClip: ( id: string ) => ref.current?.removeClip( id ),
			appendComposerText: ( text: string ) => ref.current?.appendComposerText( text ),
		} ),
		[ ref ]
	);
}

/** The on-screen session's clip markers, for the preview to mirror into the
 * guest page. */
export function useSessionPreviewClipMarkers(): ClipMarker[] {
	return useSessionUIState().previewClips.markers;
}

/** Publisher side: the composer keeps this in sync with its attachments. */
export function useSessionPreviewClipMarkersPublisher(): ( markers: ClipMarker[] ) => void {
	const dispatch = useSessionUIDispatch();
	return useCallback(
		( markers: ClipMarker[] ) => dispatch( { type: 'preview-clips/set-markers', markers } ),
		[ dispatch ]
	);
}
