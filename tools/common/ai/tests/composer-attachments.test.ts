import { describe, expect, it } from 'vitest';
import { STUDIO_CHAT_MAX_FILES } from '../chat-files';
import { STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES } from '../chat-images';
import {
	mergeComposerAttachments,
	prepareComposerAttachments,
	type ComposerAttachment,
} from '../composer-attachments';

const prepareMessages = {
	imageTooLarge: 'image too large',
	imageReadFailed: 'image read failed',
	fileAttachFailed: 'file attach failed',
};

const mergeMessages = {
	maxImages: 'too many images',
	totalImagesTooLarge: 'images too large',
	maxFiles: 'too many files',
};

function createFileAttachment( id: string ): ComposerAttachment {
	return { id, kind: 'file', name: `${ id }.txt`, path: `/tmp/${ id }.txt`, size: 10 };
}

function createImageAttachment( id: string, size: number ): ComposerAttachment {
	return {
		id,
		kind: 'image',
		name: `${ id }.png`,
		mimeType: 'image/png',
		size,
		dataBase64: 'aW1hZ2U=',
	};
}

describe( 'prepareComposerAttachments', () => {
	it( 'returns an attach error when resolving a file path fails', async () => {
		const result = await prepareComposerAttachments(
			[ new File( [ '%PDF-1.7' ], 'sample.pdf', { type: 'application/pdf' } ) ],
			{
				resolveFilePath: async () => {
					throw new Error( 'Missing path' );
				},
				messages: prepareMessages,
			}
		);

		expect( result.attachments ).toEqual( [] );
		expect( result.error ).toBe( prepareMessages.fileAttachFailed );
	} );

	it( 'builds text previews for path-backed file attachments', async () => {
		const result = await prepareComposerAttachments(
			[ new File( [ 'Hello Studio' ], 'notes.txt', { type: 'text/plain' } ) ],
			{
				resolveFilePath: () => '/tmp/notes.txt',
				messages: prepareMessages,
			}
		);

		expect( result.error ).toBeNull();
		expect( result.attachments ).toHaveLength( 1 );
		expect( result.attachments[ 0 ] ).toMatchObject( {
			kind: 'file',
			name: 'notes.txt',
			path: '/tmp/notes.txt',
			mimeType: 'text/plain',
			size: 12,
			preview: { kind: 'text', text: 'Hello Studio' },
		} );
	} );
} );

describe( 'mergeComposerAttachments', () => {
	it( 'keeps existing attachments when a file batch would exceed the file limit', () => {
		const current: ComposerAttachment[] = Array.from(
			{ length: STUDIO_CHAT_MAX_FILES },
			( _value, index ) => createFileAttachment( `file-${ index }` )
		);

		const result = mergeComposerAttachments(
			current,
			[ createFileAttachment( 'extra-file' ) ],
			mergeMessages
		);

		expect( result.attachments ).toEqual( current );
		expect( result.error ).toBe( mergeMessages.maxFiles );
	} );

	it( 'rejects images that would exceed the total image byte limit', () => {
		const current = [
			createImageAttachment( 'existing-image', STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES - 1 ),
		];
		const next = [ createImageAttachment( 'extra-image', 2 ) ];

		const result = mergeComposerAttachments( current, next, mergeMessages );

		expect( result.attachments ).toEqual( current );
		expect( result.error ).toBe( mergeMessages.totalImagesTooLarge );
	} );
} );
