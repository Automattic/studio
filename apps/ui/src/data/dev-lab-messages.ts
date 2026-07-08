import type { PersistentMessage } from '@/data/queries/use-app-messages';

// Dev-only "message lab" card injection (see components/dev-message-lab).
// Module-level store, same shape as the session-dismissal store in
// use-app-messages: the lab (dev-gated) is the only writer; the messages hook
// always reads it, which is an empty array in production.

let labMessages: readonly PersistentMessage[] = [];
const listeners = new Set< () => void >();

function emit() {
	for ( const listener of listeners ) {
		listener();
	}
}

export function subscribeLabMessages( listener: () => void ): () => void {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

export function getLabMessages(): readonly PersistentMessage[] {
	return labMessages;
}

export function isLabMessageActive( id: string ): boolean {
	return labMessages.some( ( message ) => message.id === id );
}

/** Adds the message, or removes it if one with the same id is showing. */
export function toggleLabMessage( message: PersistentMessage ): void {
	labMessages = isLabMessageActive( message.id )
		? labMessages.filter( ( existing ) => existing.id !== message.id )
		: [ ...labMessages, message ];
	emit();
}
