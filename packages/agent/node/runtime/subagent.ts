import { Type } from 'typebox';
import { addAssistantMessageUsage, createTokenUsage } from '@studio/agent/node/token-usage';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

type AssistantMessage = Extract<
	Extract< AgentSessionEvent, { type: 'message_end' } >[ 'message' ],
	{ role: 'assistant' }
>;

/** A Studio Code turn run for one task, from a fresh session: its events, and a way to stop it. */
export type RunTurn = (
	task: string,
	onEvent: ( event: AgentSessionEvent ) => void
) => Promise< { result: Promise< void >; interrupt(): Promise< void > } >;

const text = ( message: AssistantMessage | undefined ) =>
	( message?.content ?? [] )
		.map( ( block ) => ( block.type === 'text' ? block.text : '' ) )
		.join( '' )
		.trim();

/**
 * Another Studio Code agent, given one task. Pi runs the tool calls of one
 * message at the same time, so several calls at once are several agents at
 * once, each with a context of its own.
 */
export function createSubagentTool(
	runTurn: RunTurn
): AgentTool< ReturnType< typeof parameters > > & { startsAtOnce: true } {
	return {
		name: 'subagent',
		label: 'subagent',
		description:
			"Runs a task as another Studio Code agent and returns its final reply. That agent starts from the task alone, with Studio's tools on the same sites and none of this conversation, so the task states what it needs and what to reply with. It cannot ask the user questions; Studio still asks the user to confirm what it would confirm for you. Several calls in one message run at the same time.",
		parameters: parameters(),
		// Its own calls wait for the work writing the files they name.
		startsAtOnce: true,
		execute: async ( _toolCallId, { task }, signal ) => {
			const replies: AssistantMessage[] = [];
			let end: Extract< AgentSessionEvent, { type: 'agent_end' } > | undefined;
			const turn = await runTurn( task, ( event ) => {
				if ( event.type === 'message_end' && event.message.role === 'assistant' ) {
					replies.push( event.message );
				}
				if ( event.type === 'agent_end' && ! event.willRetry ) {
					end = event;
				}
			} );
			const stop = () => void turn.interrupt();
			signal?.addEventListener( 'abort', stop, { once: true } );
			try {
				await turn.result;
			} finally {
				signal?.removeEventListener( 'abort', stop );
			}
			const failed = end?.messages.find(
				( message ): message is AssistantMessage =>
					message.role === 'assistant' &&
					( message.stopReason === 'error' || message.stopReason === 'aborted' )
			);
			if ( failed ) {
				throw new Error(
					`The subagent stopped: ${ failed.errorMessage || failed.stopReason }${
						text( replies.at( -1 ) ) ? `. Its last reply: ${ text( replies.at( -1 ) ) }` : ''
					}`
				);
			}
			const usage = createTokenUsage();
			for ( const reply of replies ) {
				addAssistantMessageUsage( usage, { type: 'message_end', message: reply } );
			}
			return {
				content: [
					{ type: 'text', text: text( replies.at( -1 ) ) || 'The subagent replied nothing.' },
				],
				// What it spent, and the model requests it made.
				details: { usage, requests: replies.length },
			};
		},
	};
}

function parameters() {
	return Type.Object( {
		task: Type.String( {
			description:
				'Everything the agent needs: what to do, on which site and files, and what to reply with.',
		} ),
	} );
}
