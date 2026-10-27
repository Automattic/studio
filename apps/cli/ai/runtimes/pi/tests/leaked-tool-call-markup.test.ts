import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { isEmptyStop } from '@studio/common/ai/session-events';
import { describe, expect, it } from 'vitest';
import { withLeakedToolCallMarkupRemoved } from '../leaked-tool-call-markup';
import type { AssistantMessage } from '@earendil-works/pi-ai';

const LEAKED_CALL =
	'<｜DSML｜tool_calls>\n<｜DSML｜invoke name="read">\n<｜DSML｜parameter name="path" string="true">style.css</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>';

async function finish(
	content: AssistantMessage[ 'content' ],
	stopReason: AssistantMessage[ 'stopReason' ] = 'stop'
): Promise< AssistantMessage > {
	const source = createAssistantMessageEventStream();
	const cleaned = withLeakedToolCallMarkupRemoved( source );
	const message = { role: 'assistant', content, stopReason } as AssistantMessage;
	source.push( { type: 'done', reason: 'stop', message } );
	source.end();
	return cleaned.result();
}

describe( 'withLeakedToolCallMarkupRemoved', () => {
	it( 'turns a reply whose only tool call leaked into an empty stop', async () => {
		const result = await finish(
			[
				{ type: 'thinking', thinking: 'Read the stylesheet.' },
				{ type: 'text', text: `Let me check the file.\n\n${ LEAKED_CALL }` },
			],
			'toolUse'
		);

		expect( result.content ).toEqual( [ { type: 'thinking', thinking: 'Read the stylesheet.' } ] );
		expect( isEmptyStop( result ) ).toBe( true );
	} );

	it( 'keeps the text and tool calls around leaked markup, and other markup', async () => {
		const table = '| a | b |\n|---|---|\n| <div> | `</p>` |';
		const toolCall = { type: 'toolCall', id: 'call-1', name: 'read', arguments: {} } as const;
		const result = await finish( [
			{ type: 'text', text: table },
			{ type: 'text', text: 'Reading it now. </｜DSML｜invoke> </｜DSML｜tool_calls>' },
			toolCall,
		] );

		expect( result.content ).toEqual( [
			{ type: 'text', text: table },
			{ type: 'text', text: 'Reading it now.' },
			toolCall,
		] );
	} );
} );
