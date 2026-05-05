import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useReducer,
	type Dispatch,
	type ReactNode,
} from 'react';

// Session-scoped UI store. Holds the slices of UI state that the chat agent
// can influence (preview panel today; future: composer, conversation pane,
// modals, etc.) so that components can read/update them while a separate
// bridge — `useSessionCommands` — translates agent events into actions.
//
// Add a new behavior by:
//   1. Extending `SessionUIState` with the new slice.
//   2. Adding action variants to `SessionUIAction` and reducer cases.
//   3. Exposing a small consumer hook (like `useSessionPreviewUI`) for the UI.
//   4. Wiring the agent event in `useSessionCommands` via `dispatch`.

export type PreviewMode = 'site' | 'panel';

interface PreviewUIState {
	open: boolean;
	mode: PreviewMode;
	sitePath: string;
	panelPath: string | null;
	reloadNonce: number;
}

export interface SessionUIState {
	preview: PreviewUIState;
}

export type SessionUIAction =
	| { type: 'preview/set-open'; value: boolean }
	| { type: 'preview/toggle' }
	| { type: 'preview/set-mode'; value: PreviewMode }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/reload' };

const INITIAL_STATE: SessionUIState = {
	preview: { open: false, mode: 'site', sitePath: '/', panelPath: null, reloadNonce: 0 },
};

/**
 * Detects panel URLs (the studio-panels admin page, optionally wrapped in
 * `/studio-auto-login?redirect_to=…`). Used to route agent navigation events
 * into the panel slot vs. the site slot, and to gate the annotation
 * inspector — panels are agent-generated UI, not the rendered site content
 * the inspector is designed to comment on.
 */
export function isPanelPath( pathOrUrl: string ): boolean {
	if ( /page=studio-panels(-wp-admin)?\b/.test( pathOrUrl ) ) return true;
	if ( pathOrUrl.includes( 'studio-auto-login' ) ) {
		try {
			const decoded = decodeURIComponent( pathOrUrl );
			return /page=studio-panels(-wp-admin)?\b/.test( decoded );
		} catch {
			return false;
		}
	}
	return false;
}

function reducer( state: SessionUIState, action: SessionUIAction ): SessionUIState {
	switch ( action.type ) {
		case 'preview/set-open':
			return state.preview.open === action.value
				? state
				: { ...state, preview: { ...state.preview, open: action.value } };
		case 'preview/toggle':
			return { ...state, preview: { ...state.preview, open: ! state.preview.open } };
		case 'preview/set-mode':
			return state.preview.mode === action.value
				? state
				: { ...state, preview: { ...state.preview, mode: action.value } };
		case 'preview/navigate': {
			// Agent navigation events are routed into the panel slot or the
			// site slot based on the URL pattern. The mode auto-switches so
			// the preview pane shows whatever the agent just navigated to;
			// the other slot keeps its previous path so the user can toggle
			// back.
			const isPanel = isPanelPath( action.path );
			return {
				...state,
				preview: {
					...state.preview,
					mode: isPanel ? 'panel' : 'site',
					sitePath: isPanel ? state.preview.sitePath : action.path,
					panelPath: isPanel ? action.path : state.preview.panelPath,
					reloadNonce: state.preview.reloadNonce + 1,
					open: true,
				},
			};
		}
		case 'preview/reload':
			return {
				...state,
				preview: {
					...state.preview,
					reloadNonce: state.preview.reloadNonce + 1,
					open: true,
				},
			};
	}
}

// Split contexts so that hooks which only need to dispatch (like
// `useSessionCommands`) don't re-run on every state change.
const SessionUIStateContext = createContext< SessionUIState | null >( null );
const SessionUIDispatchContext = createContext< Dispatch< SessionUIAction > | null >( null );

export function SessionUIProvider( { children }: { children: ReactNode } ) {
	const [ state, dispatch ] = useReducer( reducer, INITIAL_STATE );
	return (
		<SessionUIDispatchContext.Provider value={ dispatch }>
			<SessionUIStateContext.Provider value={ state }>{ children }</SessionUIStateContext.Provider>
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
	readonly mode: PreviewMode;
	readonly path: string;
	readonly sitePath: string;
	readonly panelPath: string | null;
	readonly reloadNonce: number;
	setOpen: ( value: boolean ) => void;
	toggle: () => void;
	setMode: ( value: PreviewMode ) => void;
}

export function useSessionPreviewUI(): SessionPreviewUI {
	const state = useSessionUIState();
	const dispatch = useSessionUIDispatch();
	const setOpen = useCallback(
		( value: boolean ) => dispatch( { type: 'preview/set-open', value } ),
		[ dispatch ]
	);
	const toggle = useCallback( () => dispatch( { type: 'preview/toggle' } ), [ dispatch ] );
	const setMode = useCallback(
		( value: PreviewMode ) => dispatch( { type: 'preview/set-mode', value } ),
		[ dispatch ]
	);
	const { mode, sitePath, panelPath, reloadNonce, open } = state.preview;
	const path = mode === 'panel' && panelPath ? panelPath : sitePath;
	return useMemo(
		() => ( { open, mode, path, sitePath, panelPath, reloadNonce, setOpen, toggle, setMode } ),
		[ open, mode, path, sitePath, panelPath, reloadNonce, setOpen, toggle, setMode ]
	);
}
