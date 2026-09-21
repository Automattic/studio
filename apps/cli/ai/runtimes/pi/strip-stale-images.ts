import type { Context, Message } from '@earendil-works/pi-ai';

/**
 * Placeholder text inserted where an image block used to live. Kept short so
 * it doesn't itself bloat the context.
 */
export const STALE_IMAGE_PLACEHOLDER_TEXT = '[image removed from older turn to save context]';

/** Keeps requests well under the wpcom AI proxy's body limit, enforced with an empty 400. */
export const MAX_IMAGE_HISTORY_BYTES = 6 * 1024 * 1024;

function imageBytes( message: Message ): number {
	if (
		( message.role !== 'user' && message.role !== 'toolResult' ) ||
		typeof message.content === 'string'
	) {
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
 * Replace older images with a placeholder once the image history exceeds
 * `maxBytes`, always keeping the newest. Dropping only the oldest keeps earlier
 * messages identical between requests, so the prompt cache survives.
 */
export function stripStaleImagesFromContext(
	ctx: Context,
	maxBytes = MAX_IMAGE_HISTORY_BYTES
): Context {
	let keptBytes = 0;
	for ( let index = ctx.messages.length - 1; index >= 0; index-- ) {
		const bytes = imageBytes( ctx.messages[ index ] );
		if ( keptBytes > 0 && keptBytes + bytes > maxBytes ) {
			return {
				...ctx,
				messages: ctx.messages.map( ( message, messageIndex ) =>
					messageIndex <= index ? stripImagesFromMessage( message ) : message
				),
			};
		}
		keptBytes += bytes;
	}
	return ctx;
}
