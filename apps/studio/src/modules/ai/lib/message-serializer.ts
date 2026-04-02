import crypto from 'crypto';
import type { TaskMessage } from '../types';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Extract text content from an SDKAssistantMessage's BetaMessage.
 */
function extractAssistantText( message: Extract< SDKMessage, { type: 'assistant' } > ): string {
	const parts: string[] = [];
	for ( const block of message.message.content ) {
		if ( block.type === 'text' ) {
			parts.push( block.text );
		}
	}
	return parts.join( '\n' );
}

/**
 * Extract tool use info from an SDKAssistantMessage.
 */
function extractToolUses( message: Extract< SDKMessage, { type: 'assistant' } > ): TaskMessage[] {
	const toolMessages: TaskMessage[] = [];
	for ( const block of message.message.content ) {
		if ( block.type === 'tool_use' ) {
			toolMessages.push( {
				id: block.id,
				role: 'tool',
				content: `Using ${ block.name }`,
				timestamp: Date.now(),
				toolName: block.name,
				toolInput: block.input,
			} );
		}
	}
	return toolMessages;
}

/**
 * Format tool input for display, handling various value types.
 */
function formatToolInput( input: unknown ): string {
	if ( ! input || typeof input !== 'object' ) {
		return String( input ?? '' );
	}
	try {
		return JSON.stringify( input, null, 2 );
	} catch {
		return String( input );
	}
}

/**
 * Extract tool results from synthetic user messages.
 * The SDK sends tool outputs as user messages with tool_result content blocks.
 */
function extractToolResults( message: Extract< SDKMessage, { type: 'user' } > ): TaskMessage[] {
	const results: TaskMessage[] = [];
	const content = message.message.content;

	if ( ! Array.isArray( content ) ) {
		return results;
	}

	for ( const block of content ) {
		if (
			typeof block === 'object' &&
			block !== null &&
			'type' in block &&
			block.type === 'tool_result'
		) {
			const toolBlock = block as {
				type: 'tool_result';
				tool_use_id: string;
				content?: string | Array< { type: string; text?: string } >;
				is_error?: boolean;
			};

			let resultText = '';
			if ( typeof toolBlock.content === 'string' ) {
				resultText = toolBlock.content;
			} else if ( Array.isArray( toolBlock.content ) ) {
				resultText = toolBlock.content
					.filter(
						( c ): c is { type: string; text: string } =>
							typeof c === 'object' && c !== null && 'text' in c
					)
					.map( ( c ) => c.text )
					.join( '\n' );
			}

			results.push( {
				id: `result-${ toolBlock.tool_use_id }`,
				role: 'tool',
				content: resultText || '(no output)',
				timestamp: Date.now(),
				toolResult: resultText,
				isError: toolBlock.is_error,
			} );
		}
	}

	return results;
}

/**
 * Convert an SDKMessage to one or more TaskMessages for the renderer.
 * Returns empty array for messages we don't need to display.
 */
export function serializeSDKMessage( sdkMessage: SDKMessage ): TaskMessage[] {
	switch ( sdkMessage.type ) {
		case 'assistant': {
			const messages: TaskMessage[] = [];
			const text = extractAssistantText( sdkMessage );
			if ( text ) {
				messages.push( {
					id: sdkMessage.uuid ?? crypto.randomUUID(),
					role: 'assistant',
					content: text,
					timestamp: Date.now(),
					isError: !! sdkMessage.error,
				} );
			}
			messages.push( ...extractToolUses( sdkMessage ) );
			return messages;
		}

		case 'user': {
			// Synthetic user messages contain tool results
			if ( sdkMessage.isSynthetic || sdkMessage.tool_use_result !== undefined ) {
				return extractToolResults( sdkMessage );
			}
			return [];
		}

		case 'tool_use_summary':
			return [
				{
					id: sdkMessage.uuid ?? crypto.randomUUID(),
					role: 'tool',
					content: sdkMessage.summary,
					timestamp: Date.now(),
				},
			];

		case 'result': {
			// Successful results are not displayed — the text is already shown
			// via the preceding 'assistant' message. Only surface errors.
			if ( sdkMessage.is_error && 'errors' in sdkMessage ) {
				return [
					{
						id: sdkMessage.uuid ?? crypto.randomUUID(),
						role: 'system',
						content: sdkMessage.errors.join( '\n' ),
						timestamp: Date.now(),
						isError: true,
					},
				];
			}
			return [];
		}

		case 'tool_progress':
			return [
				{
					id: `progress-${ sdkMessage.tool_use_id }`,
					role: 'tool',
					content: `${ sdkMessage.tool_name } running...`,
					timestamp: Date.now(),
					toolName: sdkMessage.tool_name,
					isStreaming: true,
				},
			];

		default:
			return [];
	}
}

export { formatToolInput };
