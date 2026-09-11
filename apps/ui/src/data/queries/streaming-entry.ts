import type { SessionEntry } from '@/data/core';

// Marks the optimistic entry holding an assistant reply that is still
// streaming in. UI-only: the flag lives on the cached object and never reaches
// the session file, so it disappears when the post-run refetch replaces the
// entry with the disk-backed one.
interface StreamingEntryMarker {
	streaming?: true;
}

export function markStreamingEntry( entry: SessionEntry ): SessionEntry {
	return { ...entry, streaming: true } as SessionEntry & StreamingEntryMarker;
}

export function isStreamingEntry( entry: SessionEntry ): boolean {
	return ( entry as StreamingEntryMarker ).streaming === true;
}
