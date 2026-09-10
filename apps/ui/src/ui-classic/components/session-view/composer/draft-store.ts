import type { ComposerAttachment } from '@studio/common/ai/composer-attachments';

export interface ComposerDraft {
	text: string;
	attachments: ComposerAttachment[];
	suggestionBaseline: string | null;
}

const MAX_CACHED_DRAFTS = 10;
const draftsBySessionId = new Map< string, ComposerDraft >();

export function getComposerDraft( sessionId: string | undefined ): ComposerDraft {
	return (
		( sessionId ? draftsBySessionId.get( sessionId ) : undefined ) ?? {
			text: '',
			attachments: [],
			suggestionBaseline: null,
		}
	);
}

export function saveComposerDraft( sessionId: string | undefined, draft: ComposerDraft ): void {
	if ( ! sessionId ) {
		return;
	}

	draftsBySessionId.delete( sessionId );
	if ( ! draft.text && draft.attachments.length === 0 ) {
		return;
	}

	draftsBySessionId.set( sessionId, draft );
	while ( draftsBySessionId.size > MAX_CACHED_DRAFTS ) {
		const oldestSessionId = draftsBySessionId.keys().next().value;
		if ( oldestSessionId === undefined ) {
			break;
		}
		draftsBySessionId.delete( oldestSessionId );
	}
}

export function clearComposerDraft( sessionId: string | undefined ): void {
	if ( sessionId ) {
		draftsBySessionId.delete( sessionId );
	}
}

export function clearComposerDrafts(): void {
	draftsBySessionId.clear();
}
