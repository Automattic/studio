import { getEffectiveSessionProvider } from '@studio/agent/protocol/providers';
import { useEffect, useSyncExternalStore } from 'react';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useIsOutOfAiCredits } from '@/data/queries/use-is-out-of-ai-credits';
import { useSession } from '@/data/queries/use-sessions';
import { useAgentRunStore } from './context';
import { initialAgentRunState } from './store';

// One dispatcher per session with queued prompts, so a queue keeps draining
// after its chat is closed.
export function QueueDispatchers() {
	const store = useAgentRunStore();
	const ids = useSyncExternalStore( store.stateStore.subscribe, () =>
		Object.entries( store.stateStore.getState() )
			.filter( ( [ , state ] ) => state.queuedPrompts.length > 0 )
			.map( ( [ sessionId ] ) => sessionId )
			.join( ' ' )
	);
	return ids
		? ids
				.split( ' ' )
				.map( ( sessionId ) => <QueueDispatcher key={ sessionId } sessionId={ sessionId } /> )
		: null;
}

function QueueDispatcher( { sessionId }: { sessionId: string } ) {
	const { stateStore, dispatchSession, startRun } = useAgentRunStore();
	const state = useSyncExternalStore(
		stateStore.subscribe,
		() => stateStore.getState()[ sessionId ] ?? initialAgentRunState
	);
	const { data: session } = useSession( sessionId );
	const { data: aiSettings, isPending: isAiSettingsPending } = useAiSettings();
	const isOutOfCredits = useIsOutOfAiCredits();
	// Holding rather than clearing: a balance spent mid-run leaves the queued
	// prompt visible and it dispatches on its own once a top-up refreshes the
	// quota, instead of being silently dropped or sent to a certain rejection.
	const held =
		! session ||
		isAiSettingsPending ||
		( isOutOfCredits && getEffectiveSessionProvider( session.entries, aiSettings ) === 'wpcom' );
	const next = state.phase === 'idle' && ! held ? state.queuedPrompts[ 0 ] : undefined;

	useEffect( () => {
		const live = stateStore.getState()[ sessionId ];
		if ( ! next || live?.phase !== 'idle' || live.queuedPrompts[ 0 ] !== next ) {
			return;
		}
		dispatchSession( sessionId, { type: 'queue_shift' } );
		const { id: _id, prompt, ...options } = next;
		// On failure, drop the whole queue so a broken backend doesn't cascade errors.
		startRun( sessionId, prompt, options ).catch( () =>
			dispatchSession( sessionId, { type: 'queue_clear' } )
		);
	}, [ dispatchSession, next, sessionId, startRun, stateStore ] );

	return null;
}
