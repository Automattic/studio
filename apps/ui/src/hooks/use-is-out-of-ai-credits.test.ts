import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useIsOutOfAiCredits } from './use-is-out-of-ai-credits';

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	useStudioAssistantQuota: vi.fn(),
} ) );

const useQuotaMock = vi.mocked( useStudioAssistantQuota );

function mockQuota( data: unknown ) {
	useQuotaMock.mockReturnValue( { data } as never );
}

describe( 'useIsOutOfAiCredits', () => {
	beforeEach( () => vi.clearAllMocks() );

	it( 'is true only once both pools are spent', () => {
		mockQuota( { costUsage: 0, costCap: 0, allowanceRemaining: 0, purchasedRemaining: 0 } );
		expect( renderHook( () => useIsOutOfAiCredits() ).result.current ).toBe( true );
	} );

	it( 'is false while either pool still has credits', () => {
		mockQuota( { costUsage: 0, costCap: 0, allowanceRemaining: 0, purchasedRemaining: 150000 } );
		expect( renderHook( () => useIsOutOfAiCredits() ).result.current ).toBe( false );

		mockQuota( { costUsage: 0, costCap: 0, allowanceRemaining: 960000, purchasedRemaining: 0 } );
		expect( renderHook( () => useIsOutOfAiCredits() ).result.current ).toBe( false );
	} );

	it( 'fails open while the quota is unknown', () => {
		mockQuota( undefined );
		expect( renderHook( () => useIsOutOfAiCredits() ).result.current ).toBe( false );
	} );

	it( 'fails open for accounts the server reports no credit pools for', () => {
		// The older monthly-cap design, where a zero balance means nothing.
		mockQuota( { costUsage: 25, costCap: 100 } );
		expect( renderHook( () => useIsOutOfAiCredits() ).result.current ).toBe( false );
	} );

	it( 'leaves a blocked account to the access gate', () => {
		mockQuota( {
			costUsage: 0,
			costCap: 0,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
			studioCodeAiHasAccess: false,
			studioCodeAiAccess: 'blocked',
		} );
		expect( renderHook( () => useIsOutOfAiCredits() ).result.current ).toBe( false );
	} );
} );
