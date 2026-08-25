import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';

export const STUDIO_ASSISTANT_TOP_UP_PRICING_URL =
	'https://public-api.wordpress.com/wpcom/v2/studio-app/ai-assistant/top-up-pricing';

// One purchasable quantity as the store prices it. `display` is shown as-is:
// the store decides how a price reads in the account's currency (symbol,
// separators, whether the minor units appear at all), and reconstructing that
// ourselves gets it wrong for every currency that isn't two-decimal dollars.
//
// The response also carries `currency`, a `step` for free-entry amounts, and
// `amount_minor` per option. Nothing renders them, and zod drops what it
// isn't asked for — add them back here the day a surface needs them.
const topUpPriceSchema = z.object( {
	credits: z.number(),
	display: z.string(),
} );

export const studioAssistantTopUpPricingSchema = z
	.object( {
		// Empty when pricing is unavailable, and not necessarily four entries
		// long — surfaces render whatever comes back. Required, not defaulted:
		// it is the only field left to check, so without it an unusable
		// response would parse as "nothing priced" instead of failing.
		options: z.array( topUpPriceSchema ),
	} )
	.transform( ( data ) => ( {
		// Cheapest first regardless of the order the server sends. More credits
		// cost more, so the credit count orders them without the minor units.
		options: [ ...data.options ].sort( ( a, b ) => a.credits - b.credits ),
	} ) );

export type StudioAssistantTopUpOption = z.infer< typeof topUpPriceSchema >;
export type StudioAssistantTopUpPricing = z.infer< typeof studioAssistantTopUpPricingSchema >;

/**
 * Parse a `/top-up-pricing` response. Resolves `null` on an unexpected shape so
 * callers fall back to the single fixed top-up rather than break.
 */
export function parseStudioAssistantTopUpPricing(
	data: unknown
): StudioAssistantTopUpPricing | null {
	const result = studioAssistantTopUpPricingSchema.safeParse( data );
	return result.success ? result.data : null;
}

/**
 * Fetch the top-up options priced for the account's currency. Resolves `null`
 * on any failure (network, auth, unexpected shape) so callers can fall back to
 * the single fixed top-up link.
 */
export async function fetchStudioAssistantTopUpPricing(
	accessToken: string
): Promise< StudioAssistantTopUpPricing | null > {
	try {
		const response = await fetch( STUDIO_ASSISTANT_TOP_UP_PRICING_URL, {
			headers: { Authorization: `Bearer ${ accessToken }` },
		} );
		if ( ! response.ok ) {
			return null;
		}
		return parseStudioAssistantTopUpPricing( await response.json() );
	} catch {
		return null;
	}
}

/**
 * Copy for the purchase dialog. The options and their prices are the store's,
 * so every string here takes them as-is: `display` is never reformatted, and
 * the credit counts are formatted for the reader's locale only.
 */
export function formatPurchaseCreditsDescription(): string {
	return __(
		'Choose a one-time AI credit amount to check out securely on WordPress.com. AI credits do not expire.'
	);
}

/**
 * Subline on a top-up card: how many credits the amount buys. The price leads
 * the card and comes straight from the store, so this only formats the count
 * for the reader's locale.
 */
export function formatTopUpOptionCreditsLabel(
	option: Pick< StudioAssistantTopUpOption, 'credits' >,
	locale?: string
): string {
	return sprintf(
		/* translators: %s: number of AI credits (e.g. 100,000). */
		__( '%s credits' ),
		new Intl.NumberFormat( locale ).format( option.credits )
	);
}

/** Confirm button, naming the price the user is about to be charged. */
export function formatContinueForPriceLabel(
	option: Pick< StudioAssistantTopUpOption, 'display' >
): string {
	return sprintf(
		/* translators: %s: price as the store formats it (e.g. US$10, £7.50). */
		__( 'Continue for %s' ),
		option.display
	);
}
