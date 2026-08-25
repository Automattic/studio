import { describe, expect, it } from 'vitest';
import { getAddAiCreditsUrl } from '@studio/common/lib/studio-assistant-quota';
import {
	formatContinueForPriceLabel,
	formatTopUpOptionCreditsLabel,
	parseStudioAssistantTopUpPricing,
	studioAssistantTopUpPricingSchema,
} from '@studio/common/lib/studio-assistant-top-up-pricing';

// The shape the endpoint documents, in a currency whose price can't be
// reconstructed from the minor units by a naive `amount_minor / 100` — the
// point being that only `display` is ever shown.
const gbpResponse = {
	currency: 'GBP',
	step: { credits: 10000, amount_minor: 75, display: '£0.75' },
	options: [
		{ credits: 100000, amount_minor: 750, display: '£7.50' },
		{ credits: 200000, amount_minor: 1500, display: '£15' },
		{ credits: 500000, amount_minor: 3750, display: '£37.50' },
		{ credits: 1000000, amount_minor: 7500, display: '£75' },
	],
};

describe( 'studioAssistantTopUpPricingSchema', () => {
	it( 'keeps the store’s formatted price verbatim', () => {
		const pricing = studioAssistantTopUpPricingSchema.parse( gbpResponse );
		expect( pricing.currency ).toBe( 'GBP' );
		expect( pricing.options.map( ( option ) => option.display ) ).toEqual( [
			'£7.50',
			'£15',
			'£37.50',
			'£75',
		] );
		expect( pricing.step?.display ).toBe( '£0.75' );
	} );

	it( 'sorts options cheapest first whatever order the server sends', () => {
		const pricing = studioAssistantTopUpPricingSchema.parse( {
			...gbpResponse,
			options: [ ...gbpResponse.options ].reverse(),
		} );
		expect( pricing.options.map( ( option ) => option.credits ) ).toEqual( [
			100000, 200000, 500000, 1000000,
		] );
	} );

	it( 'accepts fewer than four options', () => {
		const pricing = studioAssistantTopUpPricingSchema.parse( {
			...gbpResponse,
			options: gbpResponse.options.slice( 0, 2 ),
		} );
		expect( pricing.options ).toHaveLength( 2 );
	} );

	it( 'accepts a priced-nothing response: no options and no step', () => {
		const pricing = studioAssistantTopUpPricingSchema.parse( {
			currency: 'GBP',
			options: [],
			step: null,
		} );
		expect( pricing.options ).toEqual( [] );
		expect( pricing.step ).toBeNull();
	} );
} );

describe( 'parseStudioAssistantTopUpPricing', () => {
	it( 'parses a well-formed response', () => {
		expect( parseStudioAssistantTopUpPricing( gbpResponse )?.options ).toHaveLength( 4 );
	} );

	it( 'resolves null rather than throwing on an unusable response', () => {
		expect( parseStudioAssistantTopUpPricing( { nope: true } ) ).toBeNull();
		expect( parseStudioAssistantTopUpPricing( null ) ).toBeNull();
	} );
} );

describe( 'purchase dialog copy', () => {
	const option = { credits: 100000, display: '£7.50' };

	it( 'says how many credits an amount buys, formatted for the reader', () => {
		expect( formatTopUpOptionCreditsLabel( option, 'en-US' ) ).toBe( '100,000 credits' );
	} );

	it( 'names the price on the confirm button', () => {
		expect( formatContinueForPriceLabel( option ) ).toBe( 'Continue for £7.50' );
	} );
} );

describe( 'getAddAiCreditsUrl', () => {
	it( 'defaults to the single fixed top-up quantity', () => {
		expect( getAddAiCreditsUrl( { returnsToDesktop: false } ) ).toBe(
			'https://wordpress.com/checkout/wpcom/studio-code-ai-credits:-q-100000'
		);
	} );

	it( 'buys the requested quantity', () => {
		expect( getAddAiCreditsUrl( { returnsToDesktop: false, credits: 500000 } ) ).toBe(
			'https://wordpress.com/checkout/wpcom/studio-code-ai-credits:-q-500000'
		);
	} );

	it( 'keeps the desktop return parameters alongside the quantity', () => {
		const url = getAddAiCreditsUrl( { returnsToDesktop: true, credits: 1000000 } );
		expect( url ).toContain( 'studio-code-ai-credits:-q-1000000?studioSiteId=' );
		expect( url ).toContain( 'studioReturnTo=ai-credits-purchased' );
	} );
} );
