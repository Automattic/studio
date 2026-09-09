import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAiCreditsMeter } from './use-ai-credits-meter';

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	useStudioAssistantQuota: vi.fn(),
} ) );

const useQuotaMock = vi.mocked( useStudioAssistantQuota );

function mockQuota( data: unknown ) {
	useQuotaMock.mockReturnValue( { data } as never );
}

describe( 'useAiCreditsMeter', () => {
	beforeEach( () => vi.clearAllMocks() );

	it( 'measures the free allowance against the monthly cap', () => {
		mockQuota( { costUsage: 0, costCap: 1000000, allowanceRemaining: 100000 } );

		expect( renderHook( () => useAiCreditsMeter() ).result.current ).toMatchObject( {
			usedCredits: 900000,
			totalCredits: 1000000,
			remainingCredits: 100000,
			fraction: 0.9,
		} );
	} );

	it( 'is null while the quota is unknown', () => {
		mockQuota( undefined );

		expect( renderHook( () => useAiCreditsMeter() ).result.current ).toBeNull();
	} );

	it( 'is null for accounts the server reports no credit pools for', () => {
		mockQuota( { costUsage: 25, costCap: 100 } );

		expect( renderHook( () => useAiCreditsMeter() ).result.current ).toBeNull();
	} );

	it( 'is null for an account held by another access gate', () => {
		mockQuota( {
			costUsage: 0,
			costCap: 1000000,
			allowanceRemaining: 100000,
			studioCodeAiHasAccess: false,
			studioCodeAiAccess: 'blocked',
		} );

		expect( renderHook( () => useAiCreditsMeter() ).result.current ).toBeNull();
	} );
} );
