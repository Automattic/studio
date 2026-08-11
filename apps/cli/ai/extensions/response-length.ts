import { DEFAULT_RESPONSE_LENGTH, type AiResponseLength } from '@studio/common/ai/response-length';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

// Per-level instructions appended to the system prompt each turn. `normal`
// stays empty so the default behavior is exactly what ships today. The
// compact wording borrows the guardrails proven by community pi extensions
// (caveman mode): keep grammar and technical precision, never touch code
// blocks, and drop terseness when clarity matters more.
export const RESPONSE_LENGTH_INSTRUCTIONS: Record< AiResponseLength, string > = {
	normal: '',
	compact: `# Response length: compact
The user has asked for compact responses. Lead every reply with the outcome or answer. No preamble, no restating the request, no hedging, and no closing summaries of what you just said. Skip headers and section structure for simple answers — short prose or a tight list is enough. Keep normal grammar and exact technical terms. Never alter code blocks, commands, paths, or quoted errors. Exception: for security warnings, destructive or irreversible actions, and errors the user must act on, prioritize clarity over brevity. Keep responses compact until the user changes this setting.`,
	verbose: `# Response length: verbose
The user has asked for thorough, explanatory responses. Walk through what you did and why: the reasoning behind decisions, relevant context, and trade-offs you weighed or alternatives you rejected. When you change code, explain how the pieces fit together and what the user should know to build on it. Structure longer replies with headings or lists so they stay scannable. Depth should come from useful explanation, not padding or repetition.`,
};

// Studio loads this through `extensionFactories` on the resource loader —
// filesystem extension discovery stays disabled (`noExtensions: true`).
export function createResponseLengthExtension(
	level: AiResponseLength = DEFAULT_RESPONSE_LENGTH
): ExtensionFactory {
	return ( pi ) => {
		pi.on( 'before_agent_start', ( event ) => {
			const instruction = RESPONSE_LENGTH_INSTRUCTIONS[ level ];
			if ( ! instruction ) {
				return;
			}
			return { systemPrompt: `${ event.systemPrompt }\n\n${ instruction }` };
		} );
	};
}
