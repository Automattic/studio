import { describe, expect, it } from 'vitest';
import { getFileToolPrompt } from '@studio/agent/shared/file-tool-prompts';

describe( 'getFileToolPrompt', () => {
	it( 'documents the pi-backed tools under their Studio names', () => {
		expect( getFileToolPrompt( 'Edit' )?.promptSnippet ).toContain(
			'several disjoint edits in one call'
		);
		expect( getFileToolPrompt( 'Grep' ) ).toEqual( {
			promptSnippet: 'Search file contents for patterns (respects .gitignore)',
		} );
		expect( getFileToolPrompt( 'wp_cli' ) ).toBeUndefined();
	} );
} );
