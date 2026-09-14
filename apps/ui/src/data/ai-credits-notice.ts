import { useSyncExternalStore } from 'react';
import type { AiCreditsMeterIntent } from '@studio/common/lib/studio-assistant-quota';

// Session-only, and deliberately not persisted: a threshold notice describes
// the balance right now, so an account that reaches 80% again in a later run
// has spent a new pool's worth of credits and deserves the warning again.
let dismissedIntent: AiCreditsMeterIntent | null = null;
const listeners = new Set< () => void >();

export function setDismissedAiCreditsIntent( intent: AiCreditsMeterIntent | null ): void {
	if ( dismissedIntent === intent ) {
		return;
	}
	dismissedIntent = intent;
	for ( const listener of listeners ) {
		listener();
	}
}

export function useDismissedAiCreditsIntent(): AiCreditsMeterIntent | null {
	return useSyncExternalStore(
		( listener ) => {
			listeners.add( listener );
			return () => {
				listeners.delete( listener );
			};
		},
		() => dismissedIntent,
		() => null
	);
}

export function resetAiCreditsNoticeForTests(): void {
	dismissedIntent = null;
}
