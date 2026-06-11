import { toImageDataUrl, toStudioChatImageAttachment, type StudioChatImage } from './chat-images';
import type { StudioChatFileAttachment } from './chat-files';
import type { StudioChatAttachmentSummary } from './sessions/entry-types';

// Builds the attachment summaries persisted on a user-prompt entry so the
// transcript can render chips. Image bytes and file paths are dropped, but a
// `data:` thumbnail URL is kept for images so the preview survives a reload.
// Composers that have a canvas downscale the thumbnail and send it as
// `previewDataUrl`; without one we fall back to inlining the full image, which
// doubles its on-disk footprint (the bytes also live in the model's message).
// Shared so the CLI turn writer and the renderer's optimistic entry stay in sync.
export function buildChatAttachmentSummaries(
	images: StudioChatImage[] = [],
	files: StudioChatFileAttachment[] = []
): StudioChatAttachmentSummary[] | undefined {
	const summaries: StudioChatAttachmentSummary[] = [
		...images.map( ( image ) => ( {
			kind: 'image' as const,
			...toStudioChatImageAttachment( image ),
			previewDataUrl: image.previewDataUrl ?? toImageDataUrl( image.mimeType, image.dataBase64 ),
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
