import { describe, expect, it } from 'vitest';
import { getFileToolPrompt } from '../file-tool-prompts';

describe( 'getFileToolPrompt', () => {
	it( 'documents the pi-backed tools under their Studio names with the enforced limits', () => {
		const edit = getFileToolPrompt( 'Edit' );
		expect( edit?.promptSnippet ).toContain( 'several disjoint edits in one call' );
		expect( edit?.promptGuidelines?.join( ' ' ) ).toContain( 'one Edit call' );
		expect( edit?.promptGuidelines?.join( ' ' ) ).toContain( '14KB across all edits[] entries' );
		expect( getFileToolPrompt( 'Write' )?.promptGuidelines?.join( ' ' ) ).toContain( '14KB' );
		expect( getFileToolPrompt( 'Bash' )?.promptGuidelines?.[ 0 ] ).toContain( '8KB' );
		expect( getFileToolPrompt( 'Grep' ) ).toEqual( {
			promptSnippet: 'Search file contents for patterns (respects .gitignore)',
		} );
		expect( getFileToolPrompt( 'wp_cli' ) ).toBeUndefined();
	} );
} );
