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
 * TODO(STU-2326): `/top-up-pricing` is not deployed yet. While this is true
 * the client answers from the stand-in below whenever the request fails, so
 * the top-up UI can be built and reviewed against a realistic response. Set
 * it to false (and delete the placeholder) once the endpoint ships — a build
 * that reaches users must never show prices the store didn't quote.
 */
const USE_PLACEHOLDER_TOP_UP_PRICING = true;

// Mirrors the quantities the current single top-up uses: credits are the same
// 1/10000 USD units the quota reports, so 100000 credits is the $10 top-up.
const PLACEHOLDER_TOP_UP_PRICING_RESPONSE = {
	currency: 'USD',
	step: { credits: 10000, amount_minor: 100, display: '$1' },
	options: [
		{ credits: 100000, amount_minor: 1000, display: '$10' },
		{ credits: 200000, amount_minor: 2000, display: '$20' },
		{ credits: 500000, amount_minor: 5000, display: '$50' },
		{ credits: 1000000, amount_minor: 10000, display: '$100' },
	],
};

function getPlaceholderTopUpPricing(): StudioAssistantTopUpPricing | null {
	if ( ! USE_PLACEHOLDER_TOP_UP_PRICING ) {
		return null;
	}
	return studioAssistantTopUpPricingSchema.parse( PLACEHOLDER_TOP_UP_PRICING_RESPONSE );
}

/**
 * Parse a `/top-up-pricing` response. An unexpected shape resolves `null` (or
 * the placeholder while it stands in) so callers fall back to the single fixed
 * top-up rather than break.
 */
export function parseStudioAssistantTopUpPricing(
	data: unknown
): StudioAssistantTopUpPricing | null {
	const result = studioAssistantTopUpPricingSchema.safeParse( data );
	return result.success ? result.data : getPlaceholderTopUpPricing();
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
			return getPlaceholderTopUpPricing();
		}
		return parseStudioAssistantTopUpPricing( await response.json() );
	} catch {
		return getPlaceholderTopUpPricing();
	}
}

/**
 * Label for a top-up button: the credits bought and what the store charges.
 * Shared by every surface so the wording stays consistent.
 */
export function formatTopUpOptionLabel(
	option: Pick< StudioAssistantTopUpOption, 'credits' | 'display' >,
	locale?: string
): string {
	return sprintf(
		/* translators: 1: number of AI credits (e.g. 100,000). 2: price as the store formats it (e.g. $10, £7.50). */
		__( '%1$s credits · %2$s' ),
		new Intl.NumberFormat( locale ).format( option.credits ),
		option.display
	);
}
