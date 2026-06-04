import { toStudioChatImageAttachment, type StudioChatImage } from './chat-images';
import type { StudioChatFileAttachment } from './chat-files';
import type { StudioChatAttachmentSummary } from './sessions/entry-types';

// Builds the lightweight attachment summaries persisted on a user-prompt entry
// (image bytes and file paths are dropped — only what a transcript chip needs).
// Shared so the CLI turn writer and the renderer's optimistic entry stay in sync.
export function buildChatAttachmentSummaries(
	images: StudioChatImage[] = [],
	files: StudioChatFileAttachment[] = []
): StudioChatAttachmentSummary[] | undefined {
	const summaries: StudioChatAttachmentSummary[] = [
		...images.map( ( image ) => ( {
			kind: 'image' as const,
			...toStudioChatImageAttachment( image ),
		} ) ),
		...files.map( ( file ) => ( {
			kind: 'file' as const,
			name: file.name,
			mimeType: file.mimeType,
			size: file.size,
		} ) ),
	];
	return summaries.length > 0 ? summaries : undefined;
}
