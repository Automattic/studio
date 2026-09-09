import { describe, expect, it } from 'vitest';
import {
	formatAiAccessRequiredNotice,
	formatAiCreditsAddedTitle,
	formatAiCreditsAvailableLabel,
	formatAiCreditsCallout,
	formatAiCreditsUsedLabel,
	getAiCreditsMeter,
	getAiCreditsMeterIntent,
	formatUsageCapNotice,
	getStudioCodeAiAccessState,
	studioAssistantQuotaSchema,
} from '@studio/common/lib/studio-assistant-quota';

const baseResponse = {
	cost_usage: 10,
	cost_cap: 100,
	cost_reset_date: '2026-09-01T00:00:00',
};

function parseAccessState( response: Record< string, unknown > ) {
	return getStudioCodeAiAccessState( studioAssistantQuotaSchema.parse( response ) );
}

describe( 'getStudioCodeAiAccessState', () => {
	it( 'is available for a granted user', () => {
		expect(
			parseAccessState( {
				...baseResponse,
				studio_code_ai_has_access: true,
				studio_code_ai_access: 'granted',
			} )
		).toBe( 'available' );
	} );

	it( 'shows the request-access state, not blocked, for an ungranted default user', () => {
		expect(
			parseAccessState( {
				...baseResponse,
				studio_code_ai_has_access: false,
				studio_code_ai_access: 'default',
			} )
		).toBe( 'not-enabled' );
	} );

	it( 'is blocked only for an explicit per-user block', () => {
		expect(
			parseAccessState( {
				...baseResponse,
				studio_code_ai_has_access: false,
				studio_code_ai_access: 'blocked',
			} )
		).toBe( 'blocked' );
	} );

	it( 'gates on has_access first: a default user is available after a default-allow flip', () => {
		expect(
			parseAccessState( {
				...baseResponse,
				studio_code_ai_has_access: true,
				studio_code_ai_access: 'default',
			} )
		).toBe( 'available' );
	} );

	it( 'treats responses from older servers without the fields as available', () => {
		expect( parseAccessState( baseResponse ) ).toBe( 'available' );
	} );
} );

describe( 'studioAssistantQuotaSchema per-pool balances', () => {
	it( 'parses the remaining balance per pool when present', () => {
		const quota = studioAssistantQuotaSchema.parse( {
			...baseResponse,
			allowance_remaining: 960000,
			purchased_remaining: 150000,
		} );
		expect( quota.allowanceRemaining ).toBe( 960000 );
		expect( quota.purchasedRemaining ).toBe( 150000 );
	} );

	it( 'keeps zero balances distinct from absent fields', () => {
		const quota = studioAssistantQuotaSchema.parse( {
			...baseResponse,
			allowance_remaining: 0,
			purchased_remaining: 0,
		} );
		expect( quota.allowanceRemaining ).toBe( 0 );
		expect( quota.purchasedRemaining ).toBe( 0 );
	} );

	it( 'leaves the balances undefined when the server omits them (feature off)', () => {
		const quota = studioAssistantQuotaSchema.parse( baseResponse );
		expect( quota.allowanceRemaining ).toBeUndefined();
		expect( quota.purchasedRemaining ).toBeUndefined();
	} );

	it( 'reads an unreachable-billing null balance as unknown, not zero', () => {
		const quota = studioAssistantQuotaSchema.parse( {
			...baseResponse,
			allowance_remaining: 960000,
			purchased_remaining: null,
		} );
		expect( quota.purchasedRemaining ).toBeUndefined();
		// The rest of the quota still parses — the access gates read from it.
		expect( quota.allowanceRemaining ).toBe( 960000 );
	} );
} );

describe( 'studioAssistantQuotaSchema purchased pool size', () => {
	it( 'parses the pool size the purchased balance is measured against', () => {
		const quota = studioAssistantQuotaSchema.parse( {
			...baseResponse,
			purchased_remaining: 150000,
			purchased_at_top_up: 500000,
		} );
		expect( quota.purchasedAtTopUp ).toBe( 500000 );
	} );

	it( 'is undefined on servers that do not report it', () => {
		expect( studioAssistantQuotaSchema.parse( baseResponse ).purchasedAtTopUp ).toBeUndefined();
	} );

	it( 'keeps a never-bought zero, so callers can tell it from a missing field', () => {
		const quota = studioAssistantQuotaSchema.parse( {
			...baseResponse,
			purchased_remaining: 0,
			purchased_at_top_up: 0,
		} );
		expect( quota.purchasedAtTopUp ).toBe( 0 );
	} );

	it( 'can be smaller than an earlier top-up: it is the last pool, not a lifetime total', () => {
		const quota = studioAssistantQuotaSchema.parse( {
			...baseResponse,
			purchased_remaining: 20000,
			purchased_at_top_up: 120000,
		} );
		// 20,000 left of the 120,000 the pool held at the last top-up.
		expect( quota.purchasedRemaining ).toBe( 20000 );
		expect( quota.purchasedAtTopUp ).toBe( 120000 );
	} );
} );

describe( 'studioAssistantQuotaSchema reset date', () => {
	it( 'parses a response without a reset date, leaving it undefined', () => {
		const quota = studioAssistantQuotaSchema.parse( { cost_usage: 10, cost_cap: 100 } );
		expect( quota.costResetDate ).toBeUndefined();
		expect( quota.costUsage ).toBe( 10 );
		expect( quota.costCap ).toBe( 100 );
	} );

	it( 'falls back to the try-again cap notice without a reset date', () => {
		expect( formatUsageCapNotice( undefined, 'en-US' ) ).toBe(
			'You’ve reached your monthly AI usage limit. Try again later.'
		);
	} );
} );

describe( 'formatAiAccessRequiredNotice', () => {
	it( 'tells accounts with spend this billing cycle that beta access is now required', () => {
		expect( formatAiAccessRequiredNotice( { costUsage: 3 } ) ).toBe(
			'Thanks for participating in the Studio Code AI beta. Access is now limited. Apply to continue at <applyLink>developer.wordpress.com/studio/studio-code-beta</applyLink>.'
		);
	} );

	it( 'falls back to the generic beta copy without spend or without a quota', () => {
		const genericNotice =
			'Studio Code AI is currently available through limited beta access. Apply at <applyLink>developer.wordpress.com/studio/studio-code-beta</applyLink>.';
		expect( formatAiAccessRequiredNotice( { costUsage: 0 } ) ).toBe( genericNotice );
		expect( formatAiAccessRequiredNotice( undefined ) ).toBe( genericNotice );
		expect( formatAiAccessRequiredNotice( null ) ).toBe( genericNotice );
	} );
} );

describe( 'getAiCreditsMeter', () => {
	// Realistic credit account: 1.5M-credit welcome allowance, part spent,
	// plus a 500k purchased pool from the last top-up.
	const creditQuota = {
		costCap: 1500000,
		allowanceRemaining: 960000,
		purchasedRemaining: 150000,
		purchasedAtTopUp: 500000,
	};

	it( 'combines both pools into one bar', () => {
		const meter = getAiCreditsMeter( creditQuota );
		expect( meter ).toEqual( {
			totalCredits: 2000000,
			remainingCredits: 1110000,
			usedCredits: 890000,
			fraction: 0.445,
		} );
	} );

	it( 'measures a never-bought account against the free allowance alone', () => {
		const meter = getAiCreditsMeter( {
			costCap: 1500000,
			allowanceRemaining: 960000,
			purchasedRemaining: 0,
			purchasedAtTopUp: 0,
		} );
		expect( meter?.totalCredits ).toBe( 1500000 );
		expect( meter?.remainingCredits ).toBe( 960000 );
	} );

	it( 'leaves the purchased pool out when billing is unreachable (unknown, not spent)', () => {
		const meter = getAiCreditsMeter( { ...creditQuota, purchasedRemaining: undefined } );
		expect( meter?.totalCredits ).toBe( 1500000 );
		expect( meter?.remainingCredits ).toBe( 960000 );
	} );

	it( 'drops the spent allowance from the total once a purchased pool exists', () => {
		// Measuring against the purchased pool alone: right after a top-up the
		// bar reads as the fresh purchase, not as mostly consumed by the gift.
		const meter = getAiCreditsMeter( { ...creditQuota, allowanceRemaining: 0 } );
		expect( meter?.totalCredits ).toBe( 500000 );
		expect( meter?.remainingCredits ).toBe( 150000 );
	} );

	it( 'keeps the spent allowance as the meter when nothing was ever bought', () => {
		const meter = getAiCreditsMeter( {
			costCap: 1500000,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
			purchasedAtTopUp: 0,
		} );
		expect( meter?.totalCredits ).toBe( 1500000 );
		expect( meter?.fraction ).toBe( 1 );
	} );

	it( 'resolves null when nothing is measurable', () => {
		// Feature off: no pool figures at all.
		expect(
			getAiCreditsMeter( {
				costCap: 1500000,
				allowanceRemaining: undefined,
				purchasedRemaining: undefined,
				purchasedAtTopUp: undefined,
			} )
		).toBeNull();
		// No usable denominator: zero cap and a never-bought purchased pool.
		expect(
			getAiCreditsMeter( {
				costCap: 0,
				allowanceRemaining: 0,
				purchasedRemaining: 0,
				purchasedAtTopUp: 0,
			} )
		).toBeNull();
	} );

	it( 'reads exhausted pools as a full bar', () => {
		const meter = getAiCreditsMeter( {
			costCap: 1500000,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
			purchasedAtTopUp: 500000,
		} );
		expect( meter?.fraction ).toBe( 1 );
		// The spent allowance is out of the total; the purchased pool is the bar.
		expect( meter?.totalCredits ).toBe( 500000 );
	} );
} );

describe( 'getAiCreditsMeterIntent', () => {
	it( 'escalates at 80%, 90%, and exhaustion', () => {
		expect( getAiCreditsMeterIntent( 0 ) ).toBe( 'ok' );
		expect( getAiCreditsMeterIntent( 0.79 ) ).toBe( 'ok' );
		expect( getAiCreditsMeterIntent( 0.8 ) ).toBe( 'warning' );
		expect( getAiCreditsMeterIntent( 0.9 ) ).toBe( 'critical' );
		expect( getAiCreditsMeterIntent( 1 ) ).toBe( 'exhausted' );
	} );
} );

describe( 'AI credits meter labels', () => {
	it( 'formats used and available figures for the reader', () => {
		expect(
			formatAiCreditsUsedLabel( { usedCredits: 1200000, totalCredits: 1500000 }, 'en-US' )
		).toBe( '1,200,000 of 1,500,000 AI credits used' );
		expect( formatAiCreditsAvailableLabel( { remainingCredits: 300000 }, 'en-US' ) ).toBe(
			'300,000 available'
		);
	} );
} );

describe( 'formatAiCreditsCallout', () => {
	const neverBought = { costCap: 1500000, allowanceRemaining: 960000, purchasedAtTopUp: 0 };

	it( 'welcomes with the allowance size from the quota, not a hardcoded figure', () => {
		expect( formatAiCreditsCallout( neverBought, { fraction: 0.36 }, 'en-US' ) ).toBe(
			'Your first 1,500,000 AI credits are on us.'
		);
	} );

	it( 'drops the welcome once the free credits are spent, even with no purchase', () => {
		expect(
			formatAiCreditsCallout(
				{ ...neverBought, allowanceRemaining: 0 },
				{ fraction: 0.5 },
				'en-US'
			)
		).toBe( 'Keep the ideas flowing. Stock up for whatever you build next.' );
	} );

	it( 'drops the welcome once the account has bought credits', () => {
		expect(
			formatAiCreditsCallout(
				{ ...neverBought, purchasedAtTopUp: 500000 },
				{ fraction: 0.36 },
				'en-US'
			)
		).toBe( 'Keep the ideas flowing. Stock up for whatever you build next.' );
	} );

	it( 'escalates with the meter, beating the welcome', () => {
		expect( formatAiCreditsCallout( neverBought, { fraction: 0.8 } ) ).toBe(
			'Top up now so your next build doesn’t stop short.'
		);
		expect( formatAiCreditsCallout( neverBought, { fraction: 0.9 } ) ).toBe(
			'You’re on a roll. Top up now and keep building.'
		);
		expect( formatAiCreditsCallout( neverBought, { fraction: 1 } ) ).toBe(
			'Your next idea is ready when you are. Top up to bring it to life.'
		);
	} );
} );

describe( 'formatAiCreditsAddedTitle', () => {
	it( 'formats the added credits for the locale', () => {
		expect( formatAiCreditsAddedTitle( 500000, 'en' ) ).toBe( '500,000 AI credits added' );
		expect( formatAiCreditsAddedTitle( 500000, 'de' ) ).toBe( '500.000 AI credits added' );
	} );
} );
