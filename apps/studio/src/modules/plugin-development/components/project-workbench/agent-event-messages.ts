import type { DevelopmentProjectAiReviewEvent } from '@studio/common/types/publishing';

type AiReviewEvent = DevelopmentProjectAiReviewEvent[ 'event' ];

const MAX_MESSAGE_LENGTH = 1200;
const MAX_TOOL_ARGUMENT_LENGTH = 220;
const INTERNAL_CHAT_MESSAGE_PATTERNS = [
	/^Studio Code started working\.$/,
	/^Studio Code finished building the proposal\.$/,
	/^Studio Code stopped before it could finish\.$/,
	/^Studio Code started a new turn\.$/,
	/^Studio Code completed the turn(?: with status: .+)?\.$/,
	/^Resuming session [0-9a-f-]+$/i,
];

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object';
}

function truncateText( value: string, maxLength = MAX_MESSAGE_LENGTH ): string {
	if ( value.length <= maxLength ) {
		return value;
	}
	return `${ value.slice( 0, maxLength - 1 ).trimEnd() }...`;
}

function getStringProperty( value: unknown, key: string ): string | undefined {
	if ( ! isRecord( value ) || typeof value[ key ] !== 'string' ) {
		return undefined;
	}
	return value[ key ];
}

function stringifyToolArguments( value: unknown ): string | undefined {
	if ( value === undefined || value === null ) {
		return undefined;
	}

	try {
		return truncateText( JSON.stringify( value ), MAX_TOOL_ARGUMENT_LENGTH );
	} catch {
		return undefined;
	}
}

function formatToolCall( block: unknown ): string | undefined {
	const name = getStringProperty( block, 'name' );
	if ( ! name ) {
		return undefined;
	}

	const args = isRecord( block ) ? stringifyToolArguments( block.arguments ) : undefined;
	if ( ! args ) {
		return `Using \`${ name }\`.`;
	}

	return `Using \`${ name }\` with \`${ args.replace( /`/g, '\\`' ) }\`.`;
}

function getContentText( content: unknown ): string[] {
	if ( ! Array.isArray( content ) ) {
		return [];
	}

	return content
		.map( ( block ) => {
			if ( ! isRecord( block ) ) {
				return undefined;
			}
			if ( block.type === 'text' && typeof block.text === 'string' ) {
				return block.text.trim();
			}
			if ( block.type === 'toolCall' ) {
				return formatToolCall( block );
			}
			return undefined;
		} )
		.filter( ( text ): text is string => Boolean( text ) );
}

function getToolResultText( toolResult: unknown ): string | undefined {
	if ( ! isRecord( toolResult ) ) {
		return undefined;
	}

	const text = getContentText( toolResult.content ).join( '\n\n' ).trim();
	if ( ! text ) {
		return undefined;
	}

	const truncatedText = truncateText( text );
	if ( toolResult.isError ) {
		return `Tool error:\n\n\`\`\`\n${ truncatedText }\n\`\`\``;
	}

	return `Tool output:\n\n\`\`\`\n${ truncatedText }\n\`\`\``;
}

function formatAgentMessageEvent( messageEvent: unknown ): string | undefined {
	if ( ! isRecord( messageEvent ) ) {
		return undefined;
	}

	if ( messageEvent.type === 'message_end' && isRecord( messageEvent.message ) ) {
		if ( messageEvent.message.role !== 'assistant' ) {
			return undefined;
		}

		const parts = getContentText( messageEvent.message.content );
		return parts.length > 0 ? truncateText( parts.join( '\n\n' ) ) : undefined;
	}

	if ( messageEvent.type === 'turn_end' && Array.isArray( messageEvent.toolResults ) ) {
		const parts = messageEvent.toolResults
			.map( getToolResultText )
			.filter( ( text ): text is string => Boolean( text ) );
		return parts.length > 0 ? parts.join( '\n\n' ) : undefined;
	}

	return undefined;
}

export function formatAiReviewEventMessage( event: AiReviewEvent ): string | undefined {
	switch ( event.type ) {
		case 'run.started':
			return 'Studio Code started working.';
		case 'run.exited':
			return event.status === 'success'
				? 'Studio Code finished building the proposal.'
				: 'Studio Code stopped before it could finish.';
		case 'turn.started':
			return 'Studio Code started a new turn.';
		case 'turn.completed':
			return event.status === 'success'
				? 'Studio Code completed the turn.'
				: `Studio Code completed the turn with status: ${ event.status }.`;
		case 'progress':
		case 'info':
			return truncateText( event.message );
		case 'error':
			return `Studio Code error: ${ truncateText( event.message ) }`;
		case 'question.asked':
			return event.questions
				.map( ( question ) => `Studio Code asked: ${ question.question }` )
				.join( '\n\n' );
		case 'message':
			return formatAgentMessageEvent( event.message );
		case 'chat.artifact':
		case 'media.share':
			return undefined;
	}
}

export function shouldAppendAiReviewEventToChat( event: AiReviewEvent ): boolean {
	return event.type === 'message' || event.type === 'error' || event.type === 'question.asked';
}

export function isInternalAiReviewChatMessage( content: string ): boolean {
	const trimmedContent = content.trim();
	return INTERNAL_CHAT_MESSAGE_PATTERNS.some( ( pattern ) => pattern.test( trimmedContent ) );
}
