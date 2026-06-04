import { describe, expect, it } from 'vitest';
import {
	STUDIO_CHAT_MAX_FILES,
	buildAttachedFilesPromptBlock,
	validateStudioChatFiles,
} from '../chat-files';

describe( 'validateStudioChatFiles', () => {
	it( 'accepts files with absolute paths within limits', () => {
		expect(
			validateStudioChatFiles( [
				{ id: 'file-1', name: 'notes.txt', path: '/Users/me/notes.txt', size: 12 },
				{ id: 'file-2', name: 'report.pdf', path: 'C:\\Users\\me\\report.pdf' },
			] )
		).toHaveLength( 2 );
	} );

	it( 'returns an empty array when nothing is attached', () => {
		expect( validateStudioChatFiles( undefined ) ).toEqual( [] );
		expect( validateStudioChatFiles( [] ) ).toEqual( [] );
	} );

	it( 'rejects too many files', () => {
		expect( () =>
			validateStudioChatFiles(
				Array.from( { length: STUDIO_CHAT_MAX_FILES + 1 }, ( _value, index ) => ( {
					id: `file-${ index }`,
					name: `file-${ index }.txt`,
					path: `/tmp/file-${ index }.txt`,
				} ) )
			)
		).toThrow( `You can attach up to ${ STUDIO_CHAT_MAX_FILES } files.` );
	} );

	it( 'rejects missing or relative paths', () => {
		expect( () =>
			validateStudioChatFiles( [ { id: 'file-1', name: 'notes.txt', path: '' } ] )
		).toThrow( 'Attached file path is missing.' );

		expect( () =>
			validateStudioChatFiles( [ { id: 'file-1', name: 'notes.txt', path: 'relative/notes.txt' } ] )
		).toThrow( 'Attached files must be referenced by an absolute path.' );
	} );

	it( 'rejects paths containing control characters', () => {
		expect( () =>
			validateStudioChatFiles( [ { id: 'file-1', name: 'notes.txt', path: '/tmp/a\nb.txt' } ] )
		).toThrow( 'Attached file path contains invalid characters.' );
	} );

	it( 'rejects missing names', () => {
		expect( () =>
			validateStudioChatFiles( [ { id: 'file-1', name: '', path: '/tmp/notes.txt' } ] )
		).toThrow( 'Attached file name is missing.' );
	} );
} );

describe( 'buildAttachedFilesPromptBlock', () => {
	it( 'returns an empty string with no files', () => {
		expect( buildAttachedFilesPromptBlock( [] ) ).toBe( '' );
	} );

	it( 'lists absolute paths the agent should read', () => {
		const block = buildAttachedFilesPromptBlock( [
			{ id: 'file-1', name: 'notes.txt', path: '/Users/me/notes.txt' },
			{ id: 'file-2', name: 'report.pdf', path: '/Users/me/report.pdf' },
		] );
		expect( block ).toContain( 'Attached files (read them as needed):' );
		expect( block ).toContain( '- /Users/me/notes.txt' );
		expect( block ).toContain( '- /Users/me/report.pdf' );
	} );
} );
