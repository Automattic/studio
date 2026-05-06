// Typed wrapper for writing Studio's `studio.*` `CustomEntry` payloads on
// top of pi's `SessionManager`. Pi-level operations (compaction, branching,
// summarization) ignore custom entries with namespaced types, and readers
// can filter cleanly via the `isStudioCustomEntry*` guards.

import type { SessionManager } from '@mariozechner/pi-coding-agent';
import type {
	StudioCustomEntryDataMap,
	StudioCustomEntryType,
} from '@studio/common/ai/sessions/entry-types';

export function appendStudioEntry< T extends StudioCustomEntryType >(
	sm: SessionManager,
	customType: T,
	data: StudioCustomEntryDataMap[ T ]
): string {
	return sm.appendCustomEntry( customType, data );
}
