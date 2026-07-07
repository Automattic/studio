import { afterEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_CHAT_MAX_FILES } from '../chat-files';
import { STUDIO_CHAT_MAX_IMAGE_BYTES, STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES } from '../chat-images';
import {
	COMPOSER_FILE_IMAGE_PREVIEW_MAX_BYTES,
	getComposerClipboardFiles,
	mergeComposerAttachments,
	prepareComposerAttachments,
	type ComposerAttachment,
} from '../composer-attachments';
import { stubImageEnvironment } from './utils/image-stubs';

const prepareMessages = {
	imageTooLarge: 'image too large',
	imageReadFailed: 'image read failed',
	fileAttachFailed: 'file attach failed',
	maxImages: 'too many images',
	totalImagesTooLarge: 'images too large',
	maxFiles: 'too many files',
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

afterEach( () => {
	vi.unstubAllGlobals();
} );

describe( 'prepareComposerAttachments', () => {
	it( 'downscales images that exceed the dimension limit before attaching', async () => {
		stubImageEnvironment( { width: 9000, height: 4500 } );

		const result = await prepareComposerAttachments(
			[ new File( [ new Uint8Array( 1024 ) ], 'huge.png', { type: 'image/png' } ) ],
			{
				resolveFilePath: () => '/tmp/huge.png',
				messages: prepareMessages,
			}
		);

		expect( result.error ).toBeNull();
		expect( result.attachments ).toHaveLength( 1 );
		expect( result.attachments[ 0 ] ).toMatchObject( {
			kind: 'image',
			name: 'huge.jpg',
			mimeType: 'image/jpeg',
			size: 'downscaled'.length,
			dataBase64: Buffer.from( 'downscaled' ).toString( 'base64' ),
		} );
	} );

	it( 'accepts an over-limit-byte image once downscaling brings it under the cap', async () => {
		stubImageEnvironment( { width: 8500, height: 8500 } );

		const result = await prepareComposerAttachments(
			[
				new File( [ new Uint8Array( STUDIO_CHAT_MAX_IMAGE_BYTES + 1 ) ], 'dense.png', {
					type: 'image/png',
				} ),
			],
			{
				resolveFilePath: () => '/tmp/dense.png',
				messages: prepareMessages,
			}
		);

		expect( result.error ).toBeNull();
		expect( result.attachments ).toHaveLength( 1 );
		expect( result.attachments[ 0 ] ).toMatchObject( {
			kind: 'image',
			mimeType: 'image/jpeg',
			size: 'downscaled'.length,
		} );
	} );

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

	it( 'builds image previews for small path-backed image attachments', async () => {
		const result = await prepareComposerAttachments(
			[ new File( [ 'fake-tiff' ], 'sample.tiff', { type: 'image/tiff' } ) ],
			{
				resolveFilePath: () => '/tmp/sample.tiff',
				messages: prepareMessages,
			}
		);

		expect( result.error ).toBeNull();
		expect( result.attachments ).toHaveLength( 1 );
		expect( result.attachments[ 0 ] ).toMatchObject( {
			kind: 'file',
			name: 'sample.tiff',
			path: '/tmp/sample.tiff',
			mimeType: 'image/tiff',
			size: 9,
			preview: {
				kind: 'image',
				dataUrl: expect.stringContaining( 'data:image/tiff' ),
			},
		} );
	} );

	it( 'skips image previews for oversized path-backed image attachments', async () => {
		const result = await prepareComposerAttachments(
			[
				new File( [ new Uint8Array( COMPOSER_FILE_IMAGE_PREVIEW_MAX_BYTES + 1 ) ], 'large.tiff', {
					type: 'image/tiff',
				} ),
			],
			{
				resolveFilePath: () => '/tmp/large.tiff',
				messages: prepareMessages,
			}
		);

		expect( result.error ).toBeNull();
		expect( result.attachments ).toHaveLength( 1 );
		expect( result.attachments[ 0 ] ).toMatchObject( {
			kind: 'file',
			name: 'large.tiff',
			path: '/tmp/large.tiff',
			mimeType: 'image/tiff',
			size: COMPOSER_FILE_IMAGE_PREVIEW_MAX_BYTES + 1,
		} );
		expect( ( result.attachments[ 0 ] as { preview?: unknown } ).preview ).toBeUndefined();
	} );

	it( 'does not resolve or preview files that exceed the current file limit', async () => {
		const resolveFilePath = vi.fn( () => '/tmp/extra.txt' );
		const result = await prepareComposerAttachments(
			[ new File( [ 'extra' ], 'extra.txt', { type: 'text/plain' } ) ],
			{
				resolveFilePath,
				messages: prepareMessages,
				existingAttachments: Array.from( { length: STUDIO_CHAT_MAX_FILES }, ( _value, index ) =>
					createFileAttachment( `file-${ index }` )
				),
			}
		);

		expect( resolveFilePath ).not.toHaveBeenCalled();
		expect( result.attachments ).toEqual( [] );
		expect( result.errors ).toEqual( [ prepareMessages.maxFiles ] );
		expect( result.error ).toBe( prepareMessages.maxFiles );
	} );

	it( 'keeps each unique error from a mixed invalid batch', async () => {
		const result = await prepareComposerAttachments(
			[
				new File( [ new Uint8Array( STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES ) ], 'large.png', {
					type: 'image/png',
				} ),
				new File( [ '%PDF-1.7' ], 'missing.pdf', { type: 'application/pdf' } ),
			],
			{
				resolveFilePath: async () => {
					throw new Error( 'Missing path' );
				},
				messages: prepareMessages,
			}
		);

		expect( result.attachments ).toEqual( [] );
		expect( result.errors ).toEqual( [
			prepareMessages.imageTooLarge,
			prepareMessages.fileAttachFailed,
		] );
		expect( result.error ).toBe(
			`${ prepareMessages.imageTooLarge } ${ prepareMessages.fileAttachFailed }`
		);
	} );

	it( 'does not add a replacement character when a text preview cuts a multibyte character', async () => {
		const result = await prepareComposerAttachments(
			[ new File( [ `${ 'a'.repeat( 2047 ) }€` ], 'notes.txt', { type: 'text/plain' } ) ],
			{
				resolveFilePath: () => '/tmp/notes.txt',
				messages: prepareMessages,
			}
		);

		expect( result.error ).toBeNull();
		expect( result.attachments[ 0 ] ).toMatchObject( {
			kind: 'file',
			preview: { kind: 'text', text: 'a'.repeat( 2047 ) },
		} );
	} );
} );

describe( 'getComposerClipboardFiles', () => {
	it( 'uses common extensions for nameless pasted files', () => {
		const files = getComposerClipboardFiles( {
			files: [ new File( [ 'hello' ], '', { type: 'text/plain' } ) ],
			items: [],
		} as unknown as DataTransfer );

		expect( files[ 0 ].name ).toBe( 'pasted-file.txt' );
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
