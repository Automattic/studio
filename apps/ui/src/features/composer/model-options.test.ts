import { describe, expect, it } from 'vitest';
import { getCreditsLabel } from '@/features/composer/model-options';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

describe( 'getCreditsLabel', () => {
	it( 'reports usage as unavailable without a quota', () => {
		expect( getCreditsLabel( null ) ).toEqual( {
			hasCredits: false,
			label: 'AI usage unavailable',
		} );
	} );

	it( 'says when no credits remain', () => {
		const quota = { allowanceRemaining: 0, purchasedRemaining: 0 } as StudioAssistantQuota;
		expect( getCreditsLabel( quota ) ).toEqual( {
			hasCredits: true,
			label: 'No AI credits remaining',
		} );
	} );

	it( 'reports the share left of a monthly cap', () => {
		const quota = { costCap: 10, costUsage: 2.5 } as StudioAssistantQuota;
		expect( getCreditsLabel( quota, 'en' ) ).toEqual( {
			hasCredits: false,
			label: 'AI allowance: 75% remaining',
		} );
	} );
} );
