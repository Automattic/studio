import { describe, expect, it } from 'vitest';
import {
	composerSubmission,
	toComposerDraftAttachments,
} from '@/features/composer/composer-submission';
import type { ComposerAttachment } from '@/data/use-composer-attachments';

const image: ComposerAttachment = {
	id: 'img',
	kind: 'image',
	name: 'shot.png',
	mimeType: 'image/png',
	size: 1,
	dataBase64: 'eA==',
};
const file: ComposerAttachment = {
	id: 'doc',
	kind: 'file',
	name: 'notes.txt',
	path: '/tmp/notes.txt',
	mimeType: 'text/plain',
	size: 12,
};

describe( 'composerSubmission', () => {
	it( 'sends the text with the attachments split into images and files', () => {
		const { prompt, options } = composerSubmission( 'Hello', [ image, file ], [] );
		expect( prompt ).toBe( 'Hello' );
		expect( options.images?.map( ( item ) => item.id ) ).toEqual( [ 'img' ] );
		expect( options.files?.map( ( item ) => item.id ) ).toEqual( [ 'doc' ] );
	} );

	it( 'asks for a review of attachments sent without text', () => {
		expect( composerSubmission( '', [ file ], [] ).prompt ).toBe(
			'Please review the attached files.'
		);
	} );

	it( 'adds staged annotations after the text', () => {
		const { prompt, options } = composerSubmission(
			'Also this',
			[],
			[ { id: 'n1', number: 1, comment: 'Bigger', images: [], tag: 'h1', path: '/' } ]
		);
		expect( prompt ).toMatch( /^Also this\n\n/ );
		expect( prompt ).toContain( 'Bigger' );
		expect( options ).toMatchObject( { displayMessage: 'Also this' } );
	} );
} );

describe( 'toComposerDraftAttachments', () => {
	it( 'restores sent images and files as draft attachments', () => {
		expect(
			toComposerDraftAttachments( {
				images: [
					{ id: 'img', name: 'shot.png', mimeType: 'image/png', size: 1, dataBase64: 'eA==' },
				],
				files: [ { id: 'doc', name: 'notes.txt', path: '/tmp/notes.txt', mimeType: 'text/plain' } ],
			} )
		).toEqual( [ image, { ...file, size: 0 } ] );
	} );
} );
