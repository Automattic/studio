import { describe, expect, it } from 'vitest';
import {
	formatAiAccessRequiredNotice,
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
