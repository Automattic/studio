import type { ComposerAttachment } from '@studio/common/ai/composer-attachments';

interface ComposerDraft {
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

// Once a send is accepted, drop what was sent from the stored draft, keeping
// anything typed or attached meanwhile.
export function completeComposerDraftSend(
	sessionId: string | undefined,
	sentText: string,
	sentAttachmentIds: ReadonlySet< string >
): void {
	const draft = getComposerDraft( sessionId );
	saveComposerDraft( sessionId, {
		text: draft.text.trim() === sentText ? '' : draft.text,
		attachments: draft.attachments.filter( ( item ) => ! sentAttachmentIds.has( item.id ) ),
		suggestionBaseline: draft.text.trim() === sentText ? null : draft.suggestionBaseline,
	} );
}

export function clearComposerDrafts(): void {
	draftsBySessionId.clear();
}
