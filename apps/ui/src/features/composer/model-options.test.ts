import { describe, expect, it } from 'vitest';
import { getCreditsLabel, getModelDescription } from '@/features/composer/model-options';
import type { AiModelId } from '@/data/core';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

describe( 'getModelDescription', () => {
	it.each( [
		[ 'fast', 'Quick fixes and questions' ],
		[ 'balanced', 'Build features, style pages, and fix bugs' ],
		[ 'claude-sonnet-5', 'Build features, style pages, and fix bugs' ],
		[ 'strong', 'Plan complex builds and solve harder problems' ],
		[ 'claude-opus-5', 'Plan complex builds and solve harder problems' ],
		[ 'gemini-3.8-flash', 'Quick fixes and questions' ],
		[ 'gemini-4-argon', 'Build features, style pages, and fix bugs' ],
		[ 'gemini-4-carbon', 'Plan complex builds and solve harder problems' ],
	] satisfies [ AiModelId, string ][] )(
		'preserves the description for %s',
		( id, description ) => {
			expect( getModelDescription( id ) ).toBe( description );
		}
	);
} );

describe( 'getCreditsLabel', () => {
	it( 'says when no credits remain', () => {
		const quota = { allowanceRemaining: 0, purchasedRemaining: 0 } as StudioAssistantQuota;
		expect( getCreditsLabel( quota ) ).toEqual( {
			hasCredits: true,
			label: 'No AI credits remaining',
		} );
	} );
} );
