import type { Context, Message } from '@earendil-works/pi-ai';

/**
 * Placeholder text inserted where an image block used to live. Kept short so
 * it doesn't itself bloat the context.
 */
export const STALE_IMAGE_PLACEHOLDER_TEXT = '[image removed from older turn to save context]';

/**
 * Base64 characters of image history a request keeps. The wpcom AI proxy
 * rejects oversized request bodies with an empty 400: it accepted 8.7 MB of
 * images and rejected 13 MB.
 */
export const MAX_IMAGE_HISTORY_BYTES = 6 * 1024 * 1024;

function imageBytes( message: Message ): number {
	if ( message.role !== 'user' && message.role !== 'toolResult' ) {
		return 0;
	}
	if ( typeof message.content === 'string' ) {
		return 0;
	}
	return message.content.reduce(
		( total, block ) => ( block.type === 'image' ? total + block.data.length : total ),
		0
	);
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
 * Return a {@link Context} whose image history fits `maxBytes`. Walking back
 * from the newest message, image-bearing messages keep their images while they
 * fit, and every older one gets a placeholder instead. The newest image-bearing
 * message is always kept. Compaction in pi-coding-agent keeps a window of
 * recent turns verbatim, so without this pass every accumulated screenshot
 * stays in history and bloats the request body past the proxy's limit.
 *
 * Only the oldest images go, so earlier messages stay byte-identical from one
 * request to the next and the prompt cache survives until the budget is hit.
 */
export function stripStaleImagesFromContext(
	ctx: Context,
	maxBytes = MAX_IMAGE_HISTORY_BYTES
): Context {
	const messages = ctx.messages;
	let keptBytes = 0;
	let keepFrom = messages.length;
	for ( let index = messages.length - 1; index >= 0; index-- ) {
		const bytes = imageBytes( messages[ index ] );
		if ( bytes === 0 ) {
			continue;
		}
		if ( keepFrom < messages.length && keptBytes + bytes > maxBytes ) {
			break;
		}
		keptBytes += bytes;
		keepFrom = index;
	}

	let mutated = false;
	const transformed = messages.map( ( message, index ) => {
		if ( index >= keepFrom || imageBytes( message ) === 0 ) {
			return message;
		}
		mutated = true;
		return stripImagesFromMessage( message );
	} );
	return mutated ? { ...ctx, messages: transformed } : ctx;
}
