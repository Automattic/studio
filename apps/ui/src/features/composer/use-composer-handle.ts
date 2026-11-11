import { useImperativeHandle, type Dispatch, type Ref, type SetStateAction } from 'react';
import {
	toComposerSendAttachments,
	type ComposerAttachment,
	type ComposerSendAttachments,
} from '@/data/use-composer-attachments';
import { toComposerDraftAttachments } from '@/features/composer/composer-submission';
import type { StudioChatFileAttachment, StudioChatImage } from '@/data/core';

/**
 * Imperative API surfaced via the Composer's forwarded ref. Lets parents
 * (a quoted selection, a reopened queued prompt) inject a draft without
 * making the value a controlled prop — the latter would re-render the entire
 * SessionView (and the heavy Conversation tree) on every keystroke.
 */
export interface ComposerHandle {
	appendDraft( text: string ): void;
	replaceDraft(
		text: string,
		options?: {
			images?: StudioChatImage[];
			files?: StudioChatFileAttachment[];
		}
	): void;
	getSubmission(): { prompt: string; attachments: ComposerSendAttachments } | null;
	focus(): void;
	send(): Promise< void >;
}

function focusAtEnd( node: HTMLTextAreaElement | null ) {
	if ( ! node ) {
		return;
	}
	node.focus();
	const length = node.value.length;
	node.setSelectionRange( length, length );
}

export function useComposerHandle(
	ref: Ref< ComposerHandle >,
	{
		value,
		setValue,
		attachments,
		restoreAttachments,
		textareaRef,
		send,
	}: {
		value: string;
		setValue: Dispatch< SetStateAction< string > >;
		attachments: ComposerAttachment[];
		restoreAttachments: ( attachments: ComposerAttachment[] ) => void;
		textareaRef: { current: HTMLTextAreaElement | null };
		send: () => Promise< void >;
	}
) {
	useImperativeHandle(
		ref,
		() => ( {
			appendDraft( text ) {
				if ( ! text ) return;
				setValue( ( current ) =>
					current.trim() ? `${ current.trimEnd() }\n\n${ text }` : text
				);
				// Defer focus to the next paint so the textarea reflects the
				// new value before we move the caret to the end.
				queueMicrotask( () => focusAtEnd( textareaRef.current ) );
			},
			replaceDraft( text, options ) {
				setValue( text );
				restoreAttachments( toComposerDraftAttachments( options ?? {} ) );
				queueMicrotask( () => focusAtEnd( textareaRef.current ) );
			},
			getSubmission() {
				const prompt = value.trim();
				if ( ! prompt && attachments.length === 0 ) return null;
				return { prompt, attachments: toComposerSendAttachments( attachments ) };
			},
			focus() {
				focusAtEnd( textareaRef.current );
			},
			send,
		} ),
		[ restoreAttachments, value, attachments, send, setValue, textareaRef ]
	);
}
