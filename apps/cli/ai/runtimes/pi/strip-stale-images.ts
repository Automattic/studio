import type { Context, ImageContent, Message } from '@earendil-works/pi-ai';

/**
 * Placeholder text inserted where an image block used to live. Kept short so
 * it doesn't itself bloat the context.
 */
export const STALE_IMAGE_PLACEHOLDER_TEXT =
	'[image removed from older turn to save context; take a new screenshot if you need to see it again]';

/**
 * How much image history a request carries: the newest image-bearing messages
 * whose images fit both limits, counted back from the end of the history.
 * Anthropic applies a stricter per-image size limit to requests carrying more
 * than 20 images, and the wpcom AI proxy rejects oversized bodies with an
 * empty 400 (probed at ~9 MB of images accepted, ~13 MB rejected). `maxBytes`
 * counts base64 characters, the size the images take in the request body.
 */
export interface ImageHistoryLimits {
	maxImages: number;
	maxBytes: number;
}

export const IMAGE_HISTORY_LIMITS: ImageHistoryLimits = {
	maxImages: 20,
	maxBytes: 6 * 1024 * 1024,
};

function imageBlocksOf( message: Message ): ImageContent[] {
	if ( message.role !== 'user' && message.role !== 'toolResult' ) {
		return [];
	}
	if ( typeof message.content === 'string' ) {
		return [];
	}
	return message.content.filter( ( block ): block is ImageContent => block.type === 'image' );
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
 * Return a {@link Context} whose image history fits `limits`: walking back
 * from the newest message, image-bearing messages keep their images while
 * they fit the budget, and every older one has its image blocks replaced with
 * a short placeholder. The newest image-bearing message is always kept.
 *
 * Images otherwise stay in history so the model can refer back to earlier
 * captures, and so requests keep a stable prefix for prompt caching: because
 * the rule keeps a suffix of the history, a message that lost its images stays
 * that way on later requests, and the cached prefix is only rewritten when the
 * budget line moves. With captures fitted to the model's resolution up front,
 * a build rarely reaches either limit. Returns the same object when nothing
 * changes.
 */
export function stripStaleImagesFromContext(
	ctx: Context,
	limits: ImageHistoryLimits = IMAGE_HISTORY_LIMITS
): Context {
	const messages = ctx.messages;
	let keptImages = 0;
	let keptBytes = 0;
	let keepFrom = messages.length;
	for ( let index = messages.length - 1; index >= 0; index-- ) {
		const images = imageBlocksOf( messages[ index ] );
		if ( images.length === 0 ) {
			continue;
		}
		const bytes = images.reduce( ( total, image ) => total + image.data.length, 0 );
		const fits =
			keptImages + images.length <= limits.maxImages && keptBytes + bytes <= limits.maxBytes;
		if ( ! fits && keepFrom < messages.length ) {
			break;
		}
		keptImages += images.length;
		keptBytes += bytes;
		keepFrom = index;
	}

	let mutated = false;
	const transformed = messages.map( ( message, index ) => {
		if ( index >= keepFrom || imageBlocksOf( message ).length === 0 ) {
			return message;
		}
		mutated = true;
		return stripImagesFromMessage( message );
	} );
	return mutated ? { ...ctx, messages: transformed } : ctx;
}
