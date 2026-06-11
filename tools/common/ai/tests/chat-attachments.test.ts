import { describe, expect, it } from 'vitest';
import { buildChatAttachmentSummaries } from '../chat-attachments';

describe( 'buildChatAttachmentSummaries', () => {
	it( 'returns undefined when there are no attachments', () => {
		expect( buildChatAttachmentSummaries( [], [] ) ).toBeUndefined();
	} );

	it( 'keeps the composer-provided thumbnail and drops the image bytes', () => {
		const summaries = buildChatAttachmentSummaries( [
			{
				id: 'image-1',
				name: 'logo.png',
				mimeType: 'image/png',
				size: 3,
				width: 80,
				height: 40,
				previewDataUrl: 'data:image/png;base64,thumb',
				dataBase64: 'YWJj',
			},
		] );

		expect( summaries ).toEqual( [
			{
				kind: 'image',
				id: 'image-1',
				name: 'logo.png',
				mimeType: 'image/png',
				size: 3,
				width: 80,
				height: 40,
				previewDataUrl: 'data:image/png;base64,thumb',
			},
		] );
	} );

	it( 'falls back to inlining the full image when no thumbnail was provided', () => {
		const summaries = buildChatAttachmentSummaries( [
			{
				id: 'image-1',
				name: 'logo.png',
				mimeType: 'image/png',
				size: 3,
				dataBase64: 'YWJj',
			},
		] );

		expect( summaries ).toMatchObject( [
			{ kind: 'image', previewDataUrl: 'data:image/png;base64,YWJj' },
		] );
	} );
} );
