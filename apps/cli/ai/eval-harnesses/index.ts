import { runClaudeConversation } from './claude-code';
import { runStudioConversation } from './studio';
import type { EvalHarness } from './types';

const harnesses: EvalHarness[] = [
	{ id: 'studio', runConversation: runStudioConversation },
	{ id: 'claude-code', runConversation: runClaudeConversation },
];

export function selectHarness( id = 'studio' ): EvalHarness {
	const harness = harnesses.find( ( item ) => item.id === id );
	if ( ! harness ) {
		throw new Error(
			`Unknown eval harness "${ id }". Known harnesses: ${ harnesses
				.map( ( item ) => item.id )
				.join( ', ' ) }`
		);
	}
	return harness;
}
