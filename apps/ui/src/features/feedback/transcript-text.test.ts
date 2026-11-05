import { describe, expect, it } from 'vitest';
import { entriesToTranscriptItems } from '@/features/chats';
import {
	assistantTextEntry,
	assistantToolCallEntry,
	promptEntry,
	toolResultEntry,
	turnClosedEntry,
} from './test-entries';
import { transcriptToText } from './transcript-text';

describe( 'transcriptToText', () => {
	it( 'lists what was said, which tools ran, and which failed', () => {
		const text = transcriptToText(
			entriesToTranscriptItems( [
				promptEntry( 'Switch to the Twenty Twenty-Five theme' ),
				assistantToolCallEntry( 'wp_cli', { command: 'theme activate twentytwentyfive' } ),
				toolResultEntry( 'Error: Theme not found.', true ),
				assistantTextEntry( 'The theme is not installed yet.' ),
				turnClosedEntry( 'success' ),
			] )
		);
		expect( text ).toBe(
			[
				'User: Switch to the Twenty Twenty-Five theme',
				'Tool wp_cli failed: Error: Theme not found.',
				'Agent: The theme is not installed yet.',
			].join( '\n' )
		);
	} );

	it( 'names a successful tool without its output and clips long text', () => {
		const long = 'x'.repeat( 2500 );
		const text = transcriptToText(
			entriesToTranscriptItems( [
				promptEntry( long ),
				assistantToolCallEntry( 'site_info' ),
				toolResultEntry( '{"name":"My site"}' ),
				turnClosedEntry( 'success' ),
			] )
		);
		expect( text ).toContain( 'Tool site_info' );
		expect( text ).not.toContain( 'My site' );
		expect( text.split( '\n' )[ 0 ] ).toHaveLength( 'User: '.length + 2000 + 1 );
	} );

	it( 'is empty for a chat with nothing in it', () => {
		expect( transcriptToText( entriesToTranscriptItems( [] ) ) ).toBe( '' );
	} );
} );
