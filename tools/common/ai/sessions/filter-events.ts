import { isStudioCustomEntryOfType } from './entry-types';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';

// Drop everything before the most recent `/clear`.
export function filterEntriesAfterLastClear( entries: SessionEntry[] ): SessionEntry[] {
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		if ( isStudioCustomEntryOfType( entries[ i ], 'studio.session_cleared' ) ) {
			return entries.slice( i + 1 );
		}
	}
	return entries;
}
