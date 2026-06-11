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

interface PreviewUIState {
	open: boolean;
	path: string;
	reloadNonce: number;
}

export interface SessionUIState {
	preview: PreviewUIState;
}

export type SessionUIAction =
	| { type: 'preview/set-open'; value: boolean }
	| { type: 'preview/toggle' }
	| { type: 'preview/navigate'; path: string }
	| { type: 'preview/update-path'; path: string };

const INITIAL_STATE: SessionUIState = {
	preview: { open: false, path: '/', reloadNonce: 0 },
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
		case 'preview/update-path':
			return state.preview.path === action.path
				? state
				: { ...state, preview: { ...state.preview, path: action.path } };
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
	readonly path: string;
	readonly reloadNonce: number;
	setOpen: ( value: boolean ) => void;
	toggle: () => void;
	updatePath: ( path: string ) => void;
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
	return useMemo(
		() => ( {
			open: state.preview.open,
			path: state.preview.path,
			reloadNonce: state.preview.reloadNonce,
			setOpen,
			toggle,
			updatePath,
		} ),
		[
			state.preview.open,
			state.preview.path,
			state.preview.reloadNonce,
			setOpen,
			toggle,
			updatePath,
		]
	);
}
