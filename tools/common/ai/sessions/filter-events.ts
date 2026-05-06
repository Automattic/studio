import { isStudioCustomEntryOfType, type SessionEntryBase } from './entry-types';

/**
 * Drop everything before the most recent `studio.session_cleared` custom
 * entry — mirroring what the user sees in the CLI when they clear the
 * conversation. Called by both the CLI replay loop and the UI session
 * view so they agree on which entries belong to the "current" conversation.
 */
export function filterEntriesAfterLastClear( entries: SessionEntryBase[] ): SessionEntryBase[] {
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		if ( isStudioCustomEntryOfType( entries[ i ], 'studio.session_cleared' ) ) {
			return entries.slice( i + 1 );
		}
	}
	return entries;
}
