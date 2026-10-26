import { describe, expect, it } from 'vitest';
import { getCreditsLabel } from '@/features/composer/model-options';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

describe( 'getCreditsLabel', () => {
	it( 'says when no credits remain', () => {
		const quota = { allowanceRemaining: 0, purchasedRemaining: 0 } as StudioAssistantQuota;
		expect( getCreditsLabel( quota ) ).toEqual( {
			hasCredits: true,
			label: 'No AI credits remaining',
		} );
	} );
} );
