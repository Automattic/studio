import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/app-providers';
import { createFakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { useAiCreditsMeter } from './use-ai-credits-meter';
import { useStudioAssistantQuota } from './use-assistant-quota';
import { useIsOutOfAiCredits } from './use-is-out-of-ai-credits';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
import type { ReactNode } from 'react';

async function renderCredits( quota: Partial< StudioAssistantQuota > | null ) {
	const connector = createFakeConnector();
	connector.getStudioAssistantQuota.mockResolvedValue( quota as StudioAssistantQuota | null );
	const queryClient = createTestQueryClient();
	const { result } = renderHook(
		() => ( {
			quota: useStudioAssistantQuota(),
			meter: useAiCreditsMeter(),
			isOut: useIsOutOfAiCredits(),
		} ),
		{
			wrapper: ( { children }: { children: ReactNode } ) => (
				<AppProviders connector={ connector } queryClient={ queryClient }>
					{ children }
				</AppProviders>
			),
		}
	);
	await waitFor( () => expect( result.current.quota.isSuccess ).toBe( true ) );
	return result.current;
}

const blocked = { studioCodeAiHasAccess: false, studioCodeAiAccess: 'blocked' } as const;

describe( 'useAiCreditsMeter', () => {
	it( 'measures the free allowance against the monthly cap', async () => {
		const { meter } = await renderCredits( {
			costUsage: 0,
			costCap: 1000000,
			allowanceRemaining: 100000,
		} );
		expect( meter ).toMatchObject( {
			usedCredits: 900000,
			totalCredits: 1000000,
			remainingCredits: 100000,
			fraction: 0.9,
		} );
	} );

	it.each( [
		[ 'the quota is unknown', null ],
		[ 'the server reports no credit pools', { costUsage: 25, costCap: 100 } ],
		[
			'another access gate holds the account',
			{ costUsage: 0, costCap: 1000000, allowanceRemaining: 100000, ...blocked },
		],
	] )( 'is null when %s', async ( _, quota ) => {
		expect( ( await renderCredits( quota ) ).meter ).toBeNull();
	} );
} );

describe( 'useIsOutOfAiCredits', () => {
	const spent = { costUsage: 0, costCap: 0, allowanceRemaining: 0, purchasedRemaining: 0 };

	it( 'is true only once both pools are spent', async () => {
		expect( ( await renderCredits( spent ) ).isOut ).toBe( true );
	} );

	it.each( [
		[ 'purchased credits remain', { ...spent, purchasedRemaining: 150000 } ],
		[ 'the allowance remains', { ...spent, allowanceRemaining: 960000 } ],
		[ 'the quota is unknown', null ],
		[ 'the server reports no credit pools', { costUsage: 25, costCap: 100 } ],
		[ 'another access gate holds the account', { ...spent, ...blocked } ],
	] )( 'fails open when %s', async ( _, quota ) => {
		expect( ( await renderCredits( quota ) ).isOut ).toBe( false );
	} );
} );
