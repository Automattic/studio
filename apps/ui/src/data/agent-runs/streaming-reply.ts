import type { SessionEntry } from '@/data/core';

// The reply pi is still writing: one optimistic entry, rewritten as it grows.
export interface StreamingReply {
	entryId: string;
	timestamp: string;
	message?: unknown;
	frame?: number;
}

// Tool calls stream in with partial JSON arguments, so their rows wait for
// `message_end`. The marker lives only in the cache: `message_end` and the
// post-run refetch replace the entry.
export function streamingReplyEntry( {
	entryId,
	timestamp,
	message,
}: StreamingReply ): SessionEntry {
	const { content } = message as { content?: Array< { type?: string } > };
	return {
		type: 'message',
		id: entryId,
		parentId: null,
		timestamp,
		streaming: true,
		message: { ...( message as object ), content: content?.filter( ( b ) => b.type === 'text' ) },
	} as unknown as SessionEntry;
}

export function isStreamingReply( entry: SessionEntry ): boolean {
	return ( entry as { streaming?: boolean } ).streaming === true;
}
