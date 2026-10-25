import { __ } from '@wordpress/i18n';
import {
	toComposerSendAttachments,
	type ComposerAttachment,
} from '@/data/use-composer-attachments';
import { annotationSubmission } from '@/features/annotations';
import type { StudioChatFileAttachment, StudioChatImage } from '@/data/core';

type StagedNote = Parameters< typeof annotationSubmission >[ 2 ][ number ];

// What a send carries: the trimmed draft and its attachments, plus any staged
// annotations. Throws when the annotations don't validate.
export function composerSubmission(
	text: string,
	attachments: ComposerAttachment[],
	notes: StagedNote[]
) {
	return notes.length
		? annotationSubmission( text, attachments, notes )
		: {
				prompt: text || __( 'Please review the attached files.' ),
				options: toComposerSendAttachments( attachments ),
		  };
}

export function toComposerDraftAttachments( {
	images = [],
	files = [],
}: {
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
} ): ComposerAttachment[] {
	return [
		...images.map(
			( image ): ComposerAttachment => ( {
				id: image.id,
				kind: 'image',
				name: image.name,
				mimeType: image.mimeType,
				size: image.size,
				dataBase64: image.dataBase64,
			} )
		),
		...files.map(
			( file ): ComposerAttachment => ( {
				id: file.id,
				kind: 'file',
				name: file.name,
				path: file.path,
				mimeType: file.mimeType,
				size: file.size ?? 0,
			} )
		),
	];
}
