import type { ComposerAttachment } from '@studio/common/ai/composer-attachments';

interface ComposerDraft {
	text: string;
	attachments: ComposerAttachment[];
}

const draftsBySessionId = new Map< string, ComposerDraft >();

export function getComposerDraft( sessionId: string | undefined ): ComposerDraft {
	return (
		( sessionId ? draftsBySessionId.get( sessionId ) : undefined ) ?? {
			text: '',
			attachments: [],
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
}

export function clearComposerDrafts(): void {
	draftsBySessionId.clear();
}
