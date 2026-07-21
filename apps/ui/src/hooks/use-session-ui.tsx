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
	path: string;
	reloadNonce: number;
	// Id of the site the current `path` belongs to, so switching to a preview
	// of a different site resets the path instead of carrying it across.
	siteId: string | null;
}

export interface SessionUIState {
	preview: PreviewUIState;
}

export type SessionUIAction =
	| { type: 'preview/set-open'; value: boolean }
	| { type: 'preview/toggle' }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/reload' }
	| { type: 'preview/update-path'; path: string }
	| { type: 'preview/set-site'; siteId: string };

const INITIAL_STATE: SessionUIState = {
	preview: { open: true, path: '/', reloadNonce: 0, siteId: null },
};

function reducer( state: SessionUIState, action: SessionUIAction ): SessionUIState {
	switch ( action.type ) {
		case 'preview/set-open':
			return state.preview.open === action.value
				? state
				: { ...state, preview: { ...state.preview, open: action.value } };
		case 'preview/toggle':
			return { ...state, preview: { ...state.preview, open: ! state.preview.open } };
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
		case 'preview/set-site':
			// Switching the previewed site resets the path so the new site opens
			// at its home page rather than inheriting the previous site's path.
			return state.preview.siteId === action.siteId
				? state
				: { ...state, preview: { ...state.preview, siteId: action.siteId, path: '/' } };
	}
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
	readonly siteId: string | null;
	setOpen: ( value: boolean ) => void;
	toggle: () => void;
	updatePath: ( path: string ) => void;
	setSite: ( siteId: string ) => void;
}

export function useSessionPreviewUI(): SessionPreviewUI {
	const state = useSessionUIState();
	const dispatch = useSessionUIDispatch();
	const setOpen = useCallback(
		( value: boolean ) => dispatch( { type: 'preview/set-open', value } ),
		[ dispatch ]
	);
	const toggle = useCallback( () => dispatch( { type: 'preview/toggle' } ), [ dispatch ] );
	const updatePath = useCallback(
		( path: string ) => dispatch( { type: 'preview/update-path', path } ),
		[ dispatch ]
	);
	const setSite = useCallback(
		( siteId: string ) => dispatch( { type: 'preview/set-site', siteId } ),
		[ dispatch ]
	);
	return useMemo(
		() => ( {
			open: state.preview.open,
			path: state.preview.path,
			reloadNonce: state.preview.reloadNonce,
			siteId: state.preview.siteId,
			setOpen,
			toggle,
			updatePath,
			setSite,
		} ),
		[
			state.preview.open,
			state.preview.path,
			state.preview.reloadNonce,
			state.preview.siteId,
			setOpen,
			toggle,
			updatePath,
			setSite,
		]
	);
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
