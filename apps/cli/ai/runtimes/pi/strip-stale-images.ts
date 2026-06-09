import type { Context, Message } from '@earendil-works/pi-ai';

/**
 * Placeholder text inserted where an image block used to live. Kept short so
 * it doesn't itself bloat the context.
 */
export const STALE_IMAGE_PLACEHOLDER_TEXT = '[image removed from older turn to save context]';

function messageContainsImage( message: Message ): boolean {
	if ( message.role !== 'user' && message.role !== 'toolResult' ) {
		return false;
	}
	const content = message.content;
	if ( typeof content === 'string' ) {
		return false;
	}
	return content.some( ( block ) => block.type === 'image' );
}

function findLastImageMessageIndex( messages: Message[] ): number {
	for ( let i = messages.length - 1; i >= 0; i-- ) {
		if ( messageContainsImage( messages[ i ] ) ) {
			return i;
		}
	}
	return -1;
}

function stripImagesFromMessage( message: Message ): Message {
	if ( message.role !== 'user' && message.role !== 'toolResult' ) {
		return message;
	}
	const content = message.content;
	if ( typeof content === 'string' ) {
		return message;
	}
	const stripped = content.map( ( block ) =>
		block.type === 'image' ? { type: 'text' as const, text: STALE_IMAGE_PLACEHOLDER_TEXT } : block
	);
	return { ...message, content: stripped } as Message;
}

/**
 * Return a new {@link Context} where every message except the most recent
 * image-bearing one has its `image` content blocks replaced with a short
 * placeholder. Compaction in pi-coding-agent keeps a window of recent turns
 * verbatim, so without this pass every accumulated screenshot stays in
 * history and bloats the request body until the wpcom AI proxy rejects it
 * with HTTP 400 (no body).
 *
 * The most recent image-bearing message is left untouched so the model can
 * still "see" what it just captured. Earlier images are assumed to have
 * already been analyzed and don't need to be re-sent.
 */
export function stripStaleImagesFromContext( ctx: Context ): Context {
	const messages = ctx.messages;
	const lastImageIdx = findLastImageMessageIndex( messages );
	if ( lastImageIdx <= 0 ) {
		return ctx;
	}

	let mutated = false;
	const transformed = messages.map( ( message, index ) => {
		if ( index >= lastImageIdx ) {
			return message;
		}
		if ( ! messageContainsImage( message ) ) {
			return message;
		}
		mutated = true;
		return stripImagesFromMessage( message );
	} );

	if ( ! mutated ) {
		return ctx;
	}

	return { ...ctx, messages: transformed };
}
