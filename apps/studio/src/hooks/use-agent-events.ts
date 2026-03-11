import { useEffect } from 'react';
import { useAppDispatch } from 'src/stores';
import { agentActions } from 'src/stores/agent-slice';

/**
 * Subscribe to agent IPC events from the main process and dispatch Redux actions.
 * Should be called once in the top-level agent tab component.
 */
export function useAgentEvents() {
	const dispatch = useAppDispatch();

	useEffect( () => {
		const unsubs = [
			window.ipcListener.subscribe( 'agent-message', ( _event, { message } ) => {
				dispatch( agentActions.agentMessageReceived( message ) );
			} ),
			window.ipcListener.subscribe( 'agent-ask-user', ( _event, { questions } ) => {
				dispatch( agentActions.askUserReceived( questions ) );
			} ),
			window.ipcListener.subscribe( 'agent-error', ( _event, { message } ) => {
				dispatch( agentActions.agentErrorReceived( message ) );
			} ),
		];

		return () => {
			for ( const unsub of unsubs ) {
				unsub();
			}
		};
	}, [ dispatch ] );
}
