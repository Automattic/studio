import type { AssistantMessageBlock } from './types';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

type ToolDetailResolver = ( name: string, input: Record< string, unknown > ) => string;

export function extractAssistantMessageBlocks(
	message: SDKMessage,
	resolveToolDetail: ToolDetailResolver
): AssistantMessageBlock[] {
	if ( message.type !== 'assistant' ) {
		return [];
	}

	const blocks: AssistantMessageBlock[] = [];
	for ( const block of message.message.content ) {
		if ( block.type === 'text' && block.text ) {
			blocks.push( {
				type: 'text',
				text: block.text,
			} );
		}

		if ( block.type === 'tool_use' && block.name ) {
			const detail =
				block.input && typeof block.input === 'object'
					? resolveToolDetail( block.name, block.input as Record< string, unknown > )
					: '';
			blocks.push( {
				type: 'tool_use',
				name: block.name,
				detail: detail || undefined,
			} );
		}
	}

	return blocks;
}

function toToolResultText( value: unknown ): string {
	if ( Array.isArray( value ) ) {
		const lines = value
			.map( ( item ) => {
				if ( typeof item === 'string' ) {
					return item;
				}

				if ( item && typeof item === 'object' ) {
					const typedItem = item as { type?: unknown; text?: unknown };
					if ( typedItem.type === 'text' && typeof typedItem.text === 'string' ) {
						return typedItem.text;
					}

					try {
						return JSON.stringify( item, null, 2 );
					} catch {
						return String( item );
					}
				}

				return String( item );
			} )
			.map( ( line ) => line.trim() )
			.filter( ( line ) => line.length > 0 );

		return lines.join( '\n' );
	}

	if ( typeof value === 'string' ) {
		return value.trim();
	}

	if ( value === null || value === undefined ) {
		return '';
	}

	try {
		return JSON.stringify( value, null, 2 );
	} catch {
		return String( value );
	}
}

export function extractToolResult(
	message: SDKMessage
): { ok: boolean; text: string } | undefined {
	if ( message.type !== 'user' ) {
		return undefined;
	}

	const rawResult = message.tool_use_result;
	if ( ! rawResult ) {
		return undefined;
	}

	if ( typeof rawResult !== 'object' ) {
		const text = String( rawResult ).trim();
		return {
			ok: true,
			text,
		};
	}

	const typedResult = rawResult as {
		content?: unknown;
		isError?: unknown;
		is_error?: unknown;
	};
	const isError = typedResult.isError === true || typedResult.is_error === true;
	const textFromContent = toToolResultText( typedResult.content );

	return {
		ok: ! isError,
		text: textFromContent,
	};
}

function toReplayToolInput( _name: string, detail?: string ): Record< string, unknown > {
	if ( ! detail ) {
		return {};
	}

	return { detail };
}

export function toReplayAssistantMessage( blocks: AssistantMessageBlock[] ): SDKMessage {
	return {
		type: 'assistant',
		message: {
			content: blocks.map( ( block, index ) => {
				if ( block.type === 'text' ) {
					return {
						type: 'text',
						text: block.text,
					};
				}

				return {
					type: 'tool_use',
					id: `replay-tool-${ index }`,
					name: block.name,
					input: toReplayToolInput( block.name, block.detail ),
				};
			} ),
		},
	} as SDKMessage;
}

export function toReplayToolResultMessage( options: { ok: boolean; text: string } ): SDKMessage {
	const normalizedText = options.text.trim();
	const content = ! normalizedText
		? []
		: [
				{
					type: 'text',
					text: options.text,
				},
		  ];

	return {
		type: 'user',
		tool_use_result: {
			isError: ! options.ok,
			content,
		},
	} as SDKMessage;
}
