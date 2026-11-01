import {
	estimateContextTokens,
	estimateTokens,
	generateSummary,
	shouldCompact,
	type AgentMessage,
	type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { Api, Message, Model, Models } from '@earendil-works/pi-ai';

// The Node runtime's settings.
const COMPACTION_SETTINGS = { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 };

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
	const models = {
		completeSimple: async ( ...args: Parameters< StreamFn > ) =>
			( await streamFn( ...args ) ).result(),
	} as unknown as Models;
	// The run's messages stay whole; the summary stands in for the first
	// `summarized` of them.
	let compacted: { summary: Message; summarized: number } | undefined;

	async function transform( messages: AgentMessage[], signal?: AbortSignal ) {
		const view = compacted
			? [ compacted.summary, ...messages.slice( compacted.summarized ) ]
			: messages;
		const { tokens } = estimateContextTokens( view );
		if ( ! shouldCompact( tokens, model.contextWindow, COMPACTION_SETTINGS ) ) {
			return view;
		}
		let cut = view.length;
		for ( let kept = 0; cut > 0 && kept < COMPACTION_SETTINGS.keepRecentTokens;  ) {
			cut--;
			kept += estimateTokens( view[ cut ] );
		}
		// A tool result stays with the call it answers.
		while ( cut < view.length && ( view[ cut ] as Message ).role === 'toolResult' ) {
			cut++;
		}
		if ( cut === 0 ) {
			return view;
		}
		const summary = await generateSummary(
			view.slice( 0, cut ),
			models,
			model,
			COMPACTION_SETTINGS.reserveTokens,
			signal
		);
		if ( ! summary.ok ) {
			throw summary.error;
		}
		compacted = {
			summary: compactionSummaryMessage( summary.value ),
			summarized: compacted ? compacted.summarized + cut - 1 : cut,
		};
		await record(
			{ summary: summary.value, tokensBefore: tokens },
			messages.length - compacted.summarized
		);
		return [ compacted.summary, ...messages.slice( compacted.summarized ) ];
	}

	return { transform };
}
