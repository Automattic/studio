import { finishTextEdits } from './store';
import type { SessionStateStore } from '@/data/agent-runs/store';

export function trackTextEditRun(
	siteId: string,
	noteIds: string[],
	sessionId: string,
	prompt: string,
	store: SessionStateStore
) {
	let started = false;
	let queued = false;
	const update = () => {
		const state = store.getState()[ sessionId ];
		if ( state?.queuedPrompts.some( ( item ) => item.prompt === prompt ) ) {
			queued = true;
			return;
		}
		if ( state?.phase === 'starting' || state?.phase === 'running' ) {
			started = true;
			return;
		}
		// An idle transition between dequeuing and starting belongs to the next run.
		if ( queued && ! started && state?.phase === 'idle' ) {
			queueMicrotask( () => {
				const next = store.getState()[ sessionId ];
				if (
					next?.phase === 'idle' &&
					! next.queuedPrompts.some( ( item ) => item.prompt === prompt )
				) {
					finishTextEdits( siteId, noteIds );
					unsubscribe();
				}
			} );
			return;
		}
		finishTextEdits( siteId, noteIds );
		unsubscribe();
	};
	const unsubscribe = store.subscribe( update );
	update();
	return unsubscribe;
}
