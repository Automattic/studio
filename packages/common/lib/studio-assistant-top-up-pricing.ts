import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';

export const STUDIO_ASSISTANT_TOP_UP_PRICING_URL =
	'https://public-api.wordpress.com/wpcom/v2/studio-app/ai-assistant/top-up-pricing';

// One purchasable quantity as the store prices it. `display` is the only
// field that may be shown: the store decides how a price reads in the
// account's currency (symbol, separators, whether the minor units appear at
// all), and reconstructing that from `amount_minor` gets it wrong for every
// currency that isn't two-decimal dollars.
const topUpPriceSchema = z
	.object( {
		credits: z.number(),
		// Minor units of `currency` (cents, yen). Analytics and sorting only.
		amount_minor: z.number(),
		display: z.string(),
	} )
	.transform( ( data ) => ( {
		credits: data.credits,
		amountMinor: data.amount_minor,
		display: data.display,
	} ) );

export const studioAssistantTopUpPricingSchema = z
	.object( {
		// Always present, even when nothing could be priced.
		currency: z.string(),
		// Empty when pricing is unavailable, and not necessarily four entries
		// long — surfaces render whatever comes back.
		options: z.array( topUpPriceSchema ).default( [] ),
		// Minimum purchase and increment for a free-entry amount; null when the
		// store can't price one.
		step: topUpPriceSchema.nullable().optional(),
	} )
	.transform( ( data ) => ( {
		currency: data.currency,
		// Cheapest first regardless of the order the server sends.
		options: [ ...data.options ].sort( ( a, b ) => a.amountMinor - b.amountMinor ),
		step: data.step ?? null,
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

/** Headline on a top-up card: how many credits the amount buys. */
export function formatTopUpOptionCreditsLabel(
	option: Pick< StudioAssistantTopUpOption, 'credits' >,
	locale?: string
): string {
	return sprintf(
		/* translators: %s: number of AI credits (e.g. 100,000). */
		__( '%s AI credits' ),
		new Intl.NumberFormat( locale ).format( option.credits )
	);
}

/** Subline on a top-up card: what the store charges, once. */
export function formatTopUpOptionPriceLabel(
	option: Pick< StudioAssistantTopUpOption, 'display' >
): string {
	return sprintf(
		/* translators: %s: price as the store formats it (e.g. US$10, £7.50). */
		__( '%s one time' ),
		option.display
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
