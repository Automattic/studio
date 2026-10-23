import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
	endedWithLeakedToolCall,
	stripLeakedToolCallMarkup,
	withLeakedToolCallMarkupRemoved,
} from '../leaked-tool-call-markup';
import type { AssistantMessage } from '@earendil-works/pi-ai';

const LEAKED_CLOSING_TAGS = '</｜DSML｜parameter> </｜DSML｜invoke> </｜DSML｜tool_calls>';
const LEAKED_FULL_CALL =
	'<｜DSML｜tool_calls>\n<｜DSML｜invoke name="read">\n<｜DSML｜parameter name="path" string="true">inc/auction-admin.php</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>';

function reply( content: AssistantMessage[ 'content' ] ): AssistantMessage {
	return {
		role: 'assistant',
		content,
		api: 'openai-completions',
		provider: 'studio-wpcom',
		model: 'fast',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: 0,
	};
}

async function finish( message: AssistantMessage ): Promise< AssistantMessage > {
	const source = createAssistantMessageEventStream();
	const cleaned = withLeakedToolCallMarkupRemoved( source );
	source.push( { type: 'done', reason: 'stop', message } );
	source.end();
	return cleaned.result();
}

describe( 'stripLeakedToolCallMarkup', () => {
	it( 'removes leaked closing tags and keeps the text before them', () => {
		expect(
			stripLeakedToolCallMarkup( `Let me check the file.\n\n${ LEAKED_CLOSING_TAGS }` )
		).toBe( 'Let me check the file.' );
	} );

	it( 'removes a whole leaked tool call, arguments included', () => {
		expect( stripLeakedToolCallMarkup( `Reading it now.\n${ LEAKED_FULL_CALL }` ) ).toBe(
			'Reading it now.'
		);
	} );

	it( 'leaves text without DSML tags unchanged, pipes and angle brackets included', () => {
		const text = '| a | b |\n|---|---|\n| <div> | `</p>` |';
		expect( stripLeakedToolCallMarkup( text ) ).toBe( text );
	} );
} );

describe( 'withLeakedToolCallMarkupRemoved', () => {
	it( 'cleans a reply whose tool call leaked and flags it', async () => {
		const result = await finish(
			reply( [ { type: 'text', text: `Let me check the file.\n\n${ LEAKED_CLOSING_TAGS }` } ] )
		);

		expect( result.content ).toEqual( [ { type: 'text', text: 'Let me check the file.' } ] );
		expect( endedWithLeakedToolCall( result ) ).toBe( true );
	} );

	it( 'drops a text block that held only leaked markup', async () => {
		const result = await finish( reply( [ { type: 'text', text: LEAKED_CLOSING_TAGS } ] ) );

		expect( result.content ).toEqual( [] );
		expect( endedWithLeakedToolCall( result ) ).toBe( true );
	} );

	it( 'cleans but does not flag a reply that still has a tool call', async () => {
		const result = await finish(
			reply( [
				{ type: 'text', text: LEAKED_CLOSING_TAGS },
				{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'style.css' } },
			] )
		);

		expect( result.content.map( ( block ) => block.type ) ).toEqual( [ 'toolCall' ] );
		expect( endedWithLeakedToolCall( result ) ).toBe( false );
	} );

	it( 'leaves an ordinary reply alone', async () => {
		const message = reply( [ { type: 'text', text: 'Done.' } ] );
		const result = await finish( message );

		expect( result ).toBe( message );
		expect( result.content ).toEqual( [ { type: 'text', text: 'Done.' } ] );
		expect( endedWithLeakedToolCall( result ) ).toBe( false );
	} );
} );
