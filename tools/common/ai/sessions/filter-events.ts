import { isStudioCustomEntryOfType, type SessionEntryBase } from './entry-types';

// Drop everything before the most recent `/clear`.
export function filterEntriesAfterLastClear( entries: SessionEntryBase[] ): SessionEntryBase[] {
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		if ( isStudioCustomEntryOfType( entries[ i ], 'studio.session_cleared' ) ) {
			return entries.slice( i + 1 );
		}
	}
	return entries;
}
