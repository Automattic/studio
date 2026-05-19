import { randomUUID } from 'crypto';
import { buildUrl } from 'cli/remote-session/remote-http';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';

/**
 * Wire-format adapter for the wpcom `studio-mobile-client/respond` endpoint.
 * Knows nothing about the inbound poll loop — by the time we reach here the
 * router has already decided this reply is bound for a studio-mobile bot.
 */

const STUDIO_MOBILE_BOT_PREFIX = 'studio_mobile_';
const TELEGRAM_BOT_BASE_PATH_RE = /\/telegram-bot(\/?$)/;

export function isStudioMobileBot( bot: string | undefined ): bot is string {
	return typeof bot === 'string' && bot.startsWith( STUDIO_MOBILE_BOT_PREFIX );
}

/**
 * Derive the studio-mobile `/respond` URL by swapping the trailing
 * `/telegram-bot` segment in `base_url` for `/studio-mobile-client`. Throws
 * loudly if the base URL doesn't have that segment — silently producing the
 * wrong URL would surface much later as a confusing 404 from a different
 * service.
 */
export function buildMobileRespondUrl( baseUrl: string ): string {
	if ( ! TELEGRAM_BOT_BASE_PATH_RE.test( baseUrl ) ) {
		throw new Error(
			`Cannot derive studio-mobile URL from base_url ${ baseUrl } (expected it to end with /telegram-bot)`
		);
	}
	const mobileBase = baseUrl.replace( TELEGRAM_BOT_BASE_PATH_RE, '/studio-mobile-client$1' );
	return buildUrl( mobileBase, 'respond' );
}

export interface MobileBodyParams {
	chatId: number;
	bot: string;
	machineId: string;
	text?: string;
	photo?: string;
	caption?: string;
	logger?: RemoteSessionLogger;
}

/**
 * Build the studio-mobile `/respond` body. `chat_id` + `bot` are the wpcom-side
 * memcache routing keys (queue is keyed `(user_id, chat_id, bot)`); `machine_id`
 * is sent for forward-compat — wpcom accepts it optionally today and will key
 * on it once Phase 2 of studio-mobile SPEC.md migrates the queue.
 */
export function buildMobileRespondBody( params: MobileBodyParams ): {
	body: string;
	contentType: string;
} {
	let text = params.text;
	if ( params.photo ) {
		params.logger?.warn( 'Dropping photo for studio_mobile bot (out-of-scope for mobile v1)', {
			machine_id: params.machineId,
			photo_base64_chars: params.photo.length,
			had_caption: Boolean( params.caption ),
		} );
		text = flattenPhotoToText( text, params.caption );
	}

	if ( ! text ) {
		throw new Error( 'Studio mobile respond requires `text` (photos are not supported yet)' );
	}

	return {
		body: JSON.stringify( {
			chat_id: params.chatId,
			bot: params.bot,
			machine_id: params.machineId,
			envelope: { type: 'agent_message', id: randomUUID(), text },
		} ),
		contentType: 'application/json',
	};
}

/**
 * Collapse a photo's text + caption into a single envelope text. Photos aren't
 * part of the mobile v1 surface (see studio-mobile SPEC.md "Out of scope for
 * v1"), so we drop the bytes and keep whatever copy the agent emitted alongside.
 */
function flattenPhotoToText( text: string | undefined, caption: string | undefined ): string {
	const trimmedCaption = caption?.trim();
	if ( text && trimmedCaption ) {
		return `${ text }\n\n${ trimmedCaption }`;
	}
	return text || trimmedCaption || '📷 (image omitted)';
}
