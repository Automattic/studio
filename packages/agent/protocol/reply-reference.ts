import { stripMediaWidgetPayloadLines } from './chat-artifacts';
import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export interface ReplyReference {
	sessionId: string;
	entryId: string;
	excerpt: string;
}

export function formatReplyPrompt( prompt: string, reply?: ReplyReference ): string {
	return reply
		? `Replying to this earlier message:\n> ${ reply.excerpt.replace(
				/\n/g,
				'\n> '
		  ) }\n\n${ prompt }`
		: prompt;
}

export function validateReplyReference( value: unknown ): ReplyReference | undefined {
	if ( value === undefined ) return;
	if ( ! value || typeof value !== 'object' ) throw new Error( 'Invalid reply reference.' );
	const reply = value as Partial< ReplyReference >;
	if (
		typeof reply.sessionId !== 'string' ||
		! reply.sessionId ||
		reply.sessionId.length > 512 ||
		typeof reply.entryId !== 'string' ||
		! reply.entryId ||
		reply.entryId.length > 512 ||
		typeof reply.excerpt !== 'string' ||
		! reply.excerpt.trim() ||
		reply.excerpt.length > 4000
	)
		throw new Error( 'Invalid reply reference.' );
	return { sessionId: reply.sessionId, entryId: reply.entryId, excerpt: reply.excerpt };
}

export function getMessagePreview( text: string ): string {
	return text
		.replace( /```[^\n]*\n([\s\S]*?)```/g, '$1' )
		.replace( /!?\[([^\]]*)\]\([^)]*\)/g, '$1' )
		.replace( /^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, '' )
		.replace( /(?:`{1,2}|\*\*|__|~~)/g, '' )
		.replace( /(^|\s)\*([^*\n]+)\*(?=\s|[.,!?]|$)/g, '$1$2' )
		.replace( /\s+/g, ' ' )
		.trim();
}

export function getReplyMessages( entries: SessionEntry[] ) {
	return entries.flatMap< { entryId: string; text: string; role: 'user' | 'assistant' } >(
		( entry ) => {
			if (
				isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) &&
				entry.data?.source === 'prompt'
			) {
				const text = [
					entry.data.text,
					...( entry.data.visualAnnotations?.map( ( note ) => note.comment ) ?? [] ),
					...( entry.data.attachments?.map( ( file ) => file.name ) ?? [] ),
				]
					.filter( Boolean )
					.join( '\n' );
				return text ? [ { entryId: entry.data.inputId ?? entry.id, text, role: 'user' } ] : [];
			}
			if ( entry.type === 'message' && entry.message.role === 'assistant' ) {
				const text = stripMediaWidgetPayloadLines(
					entry.message.content
						.filter( ( block ) => block.type === 'text' )
						.map( ( block ) => ( 'text' in block ? block.text : '' ) )
						.join( '\n' )
				).trim();
				return text ? [ { entryId: entry.id, text, role: 'assistant' } ] : [];
			}
			return [];
		}
	);
}
