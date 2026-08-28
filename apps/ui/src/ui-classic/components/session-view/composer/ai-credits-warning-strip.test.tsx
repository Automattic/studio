import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { AiCreditsWarningStrip } from './ai-credits-warning-strip';

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	useStudioAssistantQuota: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: () => 'en',
} ) );

vi.mock( '@/components/add-ai-credits-button', () => ( {
	AddAiCreditsButton: () => <button type="button">Add AI credits</button>,
} ) );

const useQuotaMock = vi.mocked( useStudioAssistantQuota );

function mockQuota( data: unknown ) {
	useQuotaMock.mockReturnValue( { data } as never );
}

describe( 'AiCreditsWarningStrip', () => {
	beforeEach( () => vi.clearAllMocks() );

	it( 'interrupts the composer once the balance enters its last tenth', () => {
		mockQuota( { costUsage: 0, costCap: 1000000, allowanceRemaining: 100000 } );

		render( <AiCreditsWarningStrip /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'At 90% usage' );
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toBeInTheDocument();
	} );

	it( 'stays out of the way below the threshold', () => {
		mockQuota( { costUsage: 0, costCap: 1000000, allowanceRemaining: 500000 } );

		const { container } = render( <AiCreditsWarningStrip /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'yields to the lockout once the balance is spent', () => {
		mockQuota( {
			costUsage: 0,
			costCap: 1000000,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
		} );

		const { container } = render( <AiCreditsWarningStrip /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing when there is no denominator to measure against', () => {
		mockQuota( { costUsage: 25, costCap: 100 } );

		const { container } = render( <AiCreditsWarningStrip /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'still warns when the meter rounds to full but credits remain', () => {
		// 999,999 of 1,000,000 spent: the meter reads exhausted, the server
		// balance does not, so neither the lockout nor a silent strip is right.
		mockQuota( { costUsage: 0, costCap: 1000000, allowanceRemaining: 1 } );

		render( <AiCreditsWarningStrip /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'At 100% usage' );
	} );
} );
