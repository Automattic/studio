import { contentText, normalizeContext } from '@earendil-works/pi-ai';
import { estimateContextTokens, estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate';
import type { AgentMessage, StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Message, Model } from '@earendil-works/pi-ai';

// pi-coding-agent's compaction, which runs in Node only: its settings, and the
// summary request it sends word for word, since the AI proxy accepts only
// system prompts it knows.
const COMPACTION_SETTINGS = { reserveTokens: 16_384, keepRecentTokens: 20_000 };
const TOOL_RESULT_MAX_CHARS = 2000;
const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;
const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export interface Compaction {
	summary: string;
	tokensBefore: number;
}

// The message a compaction's summary stands in the history as.
export function compactionSummaryMessage( summary: string ): Message {
	return {
		role: 'user',
		content: [
			{
				type: 'text',
				text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${ summary }\n</summary>`,
			},
		],
		timestamp: Date.now(),
	};
}

// The conversation as text, so the model summarizes it rather than continuing it.
function serializeConversation( messages: Message[] ): string {
	const parts: string[] = [];
	for ( const message of messages ) {
		if ( message.role === 'user' ) {
			const text = contentText( message.content, '' );
			if ( text ) {
				parts.push( `[User]: ${ text }` );
			}
		} else if ( message.role === 'assistant' ) {
			const calls = message.content.flatMap( ( block ) =>
				block.type === 'toolCall'
					? [
							`${ block.name }(${ Object.entries( block.arguments )
								.map( ( [ key, value ] ) => `${ key }=${ JSON.stringify( value ) }` )
								.join( ', ' ) })`,
					  ]
					: []
			);
			if ( message.content.some( ( block ) => block.type === 'text' ) ) {
				parts.push( `[Assistant]: ${ contentText( message.content ) }` );
			}
			if ( calls.length ) {
				parts.push( `[Assistant tool calls]: ${ calls.join( '; ' ) }` );
			}
		} else if ( message.role === 'toolResult' ) {
			const text = contentText( message.content, '' );
			if ( text ) {
				const extra = text.length - TOOL_RESULT_MAX_CHARS;
				parts.push(
					`[Tool result]: ${
						extra > 0
							? `${ text.slice(
									0,
									TOOL_RESULT_MAX_CHARS
							  ) }\n\n[... ${ extra } more characters truncated]`
							: text
					}`
				);
			}
		}
	}
	return parts.join( '\n\n' );
}

async function summarize(
	messages: Message[],
	model: Model< Api >,
	streamFn: StreamFn,
	signal?: AbortSignal
): Promise< string > {
	const context = normalizeContext( {
		systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: `<conversation>\n${ serializeConversation(
							messages
						) }\n</conversation>\n\n${ SUMMARIZATION_PROMPT }`,
					},
				],
				timestamp: Date.now(),
			},
		],
	} );
	const response = await (
		await streamFn( model, context, { signal, cacheRetention: 'none' } )
	).result();
	if ( response.stopReason === 'error' ) {
		throw new Error( `Summarization failed: ${ response.errorMessage || 'Unknown error' }` );
	}
	if ( response.stopReason === 'length' ) {
		throw new Error(
			'Summarization failed: generation hit the token cap and the summary is incomplete'
		);
	}
	return contentText( response.content );
}

/**
 * Summarizes the start of a run's context once it nears the model's window, as
 * pi's coding agent does in Node. Hand `transform` to the agent as its
 * `transformContext`; `record` gets each compaction with the number of recent
 * messages it kept.
 */
export function createCompactor(
	model: Model< Api >,
	streamFn: StreamFn,
	record: ( compaction: Compaction, kept: number ) => Promise< void >
) {
	// The run's messages stay whole; the summary stands in for the first
	// `summarized` of them.
	let compacted: { summary: Message; summarized: number } | undefined;

	async function transform( messages: AgentMessage[], signal?: AbortSignal ) {
		const view = (
			compacted ? [ compacted.summary, ...messages.slice( compacted.summarized ) ] : messages
		) as Message[];
		const { tokens } = estimateContextTokens( view );
		if ( tokens <= model.contextWindow - COMPACTION_SETTINGS.reserveTokens ) {
			return view;
		}
		let cut = view.length;
		for ( let kept = 0; cut > 0 && kept < COMPACTION_SETTINGS.keepRecentTokens;  ) {
			cut--;
			kept += estimateMessageTokens( view[ cut ] );
		}
		// A tool result stays with the call it answers.
		while ( cut < view.length && view[ cut ].role === 'toolResult' ) {
			cut++;
		}
		if ( cut === 0 ) {
			return view;
		}
		const summary = await summarize( view.slice( 0, cut ), model, streamFn, signal );
		compacted = {
			summary: compactionSummaryMessage( summary ),
			summarized: compacted ? compacted.summarized + cut - 1 : cut,
		};
		await record( { summary, tokensBefore: tokens }, messages.length - compacted.summarized );
		return [ compacted.summary, ...messages.slice( compacted.summarized ) ];
	}

	return { transform };
}
