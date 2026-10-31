import { expect, test } from 'vitest';
import { extractToolResult } from 'cli/ai/eval-tool-results';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// A transcript audit reads what the model read: Studio's notes come in a text
// block after the tool's own output.
test( 'a tool result keeps every text block, Studio notes included', () => {
	const event = {
		type: 'tool_execution_end',
		toolCallId: '1',
		toolName: 'Bash',
		isError: false,
		result: {
			content: [
				{ type: 'text', text: 'Success: Updated post 11.' },
				{ type: 'text', text: '<studio-notes>\nPage 11 changed.\n</studio-notes>' },
			],
		},
	} as unknown as AgentSessionEvent;
	expect( extractToolResult( event )?.text ).toBe(
		'Success: Updated post 11.\n<studio-notes>\nPage 11 changed.\n</studio-notes>'
	);
} );
