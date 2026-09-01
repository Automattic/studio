import '@testing-library/jest-dom/vitest';
import { getAddAiCreditsUrl } from '@studio/common/lib/studio-assistant-quota';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	useGetStudioAssistantQuota,
	useGetStudioAssistantTopUpPricing,
} from 'src/stores/wpcom-api';
import { AiCreditsControl } from './ai-credits-control';

const { openURL, refetchQuota } = vi.hoisted( () => ( {
	openURL: vi.fn(),
	refetchQuota: vi.fn(),
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( { openURL } ),
} ) );

vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( { isAuthenticated: true } ),
} ) );

vi.mock( 'src/stores', () => ( {
	useI18nLocale: () => 'en',
} ) );

vi.mock( 'src/stores/wpcom-api', () => ( {
	useGetStudioAssistantQuota: vi.fn(),
	useGetStudioAssistantTopUpPricing: vi.fn(),
} ) );

vi.mock( 'src/components/ai-credits-purchase-dialog', () => ( {
	AiCreditsPurchaseDialog: ( { open }: { open: boolean } ) =>
		open ? <div role="dialog">Add AI credits</div> : null,
} ) );

const useQuotaMock = vi.mocked( useGetStudioAssistantQuota );
const usePricingMock = vi.mocked( useGetStudioAssistantTopUpPricing );

function mockQuota( data: Record< string, unknown > | undefined ) {
	useQuotaMock.mockReturnValue( { data, refetch: refetchQuota } as never );
}

async function openMenu() {
	fireEvent.click( screen.getByRole( 'button', { name: 'AI credits' } ) );
	await waitFor( () => expect( screen.getAllByRole( 'menuitem' ).length ).toBe( 1 ) );
}

describe( 'AiCreditsControl', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		usePricingMock.mockReturnValue( { data: undefined } as never );
		mockQuota( {
			costUsage: 0,
			costCap: 1_000_000,
			allowanceRemaining: 960000,
			purchasedRemaining: 150000,
			purchasedAtTopUp: 200_000,
		} );
	} );

	it( 'renders nothing when the quota has no per-pool balance fields', () => {
		mockQuota( { costUsage: 25, costCap: 100, costResetDate: '2026-08-01T12:00:00' } );

		const { container } = render( <AiCreditsControl /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing while the quota is still unknown', () => {
		mockQuota( undefined );

		const { container } = render( <AiCreditsControl /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing for an account without Studio Code AI access', () => {
		mockQuota( {
			costUsage: 0,
			costCap: 0,
			studioCodeAiHasAccess: false,
			studioCodeAiAccess: 'blocked',
			allowanceRemaining: 960000,
			purchasedRemaining: 0,
		} );

		const { container } = render( <AiCreditsControl /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'sums the allowance and purchased pools in the menu summary', async () => {
		render( <AiCreditsControl /> );

		await openMenu();

		expect( screen.getByText( '1,110,000 remaining' ) ).toBeInTheDocument();
	} );

	it( 'draws the used fraction of the metered pools on the ring', () => {
		const { container } = render( <AiCreditsControl /> );

		// 90,000 of 1,200,000 used → 8% fill.
		expect( container.querySelector( 'svg' ) ).not.toHaveAttribute( 'data-intent' );
		expect( container.querySelector( 'circle:last-child' ) ).toHaveAttribute(
			'stroke-dashoffset',
			'92'
		);
	} );

	it( 'resets the ring to the purchased pool once the allowance is spent', () => {
		mockQuota( {
			costUsage: 100,
			costCap: 1_000_000,
			allowanceRemaining: 0,
			purchasedRemaining: 150000,
			purchasedAtTopUp: 200_000,
		} );

		const { container } = render( <AiCreditsControl /> );

		// The spent allowance drops out of the meter: 50,000 of 200,000
		// purchased credits used, same as the Settings → Usage bar.
		expect( container.querySelector( 'circle:last-child' ) ).toHaveAttribute(
			'stroke-dashoffset',
			'75'
		);
	} );

	it( 'escalates to the warning intent at 80% of the metered credits used', () => {
		mockQuota( {
			costUsage: 0,
			costCap: 1_000_000,
			allowanceRemaining: 150000,
			purchasedRemaining: 30000,
			purchasedAtTopUp: 100_000,
		} );

		const { container } = render( <AiCreditsControl /> );

		// 920,000 of 1,100,000 used → ~84%.
		expect( container.querySelector( 'svg' ) ).toHaveAttribute( 'data-intent', 'warning' );
	} );

	it( 'escalates to the critical intent at 90% of the metered credits used', () => {
		mockQuota( {
			costUsage: 0,
			costCap: 1_000_000,
			allowanceRemaining: 70000,
			purchasedRemaining: 30000,
			purchasedAtTopUp: 100_000,
		} );

		const { container } = render( <AiCreditsControl /> );

		expect( container.querySelector( 'svg' ) ).toHaveAttribute( 'data-intent', 'critical' );
	} );

	it( 'shows the exhausted intent when the combined balance is empty', () => {
		mockQuota( {
			costUsage: 100,
			costCap: 1_000_000,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
		} );

		const { container } = render( <AiCreditsControl /> );

		expect( container.querySelector( 'svg' ) ).toHaveAttribute( 'data-intent', 'exhausted' );
		expect( container.querySelector( 'circle:last-child' ) ).toHaveAttribute(
			'stroke-dashoffset',
			'0'
		);
	} );

	it( 'renders a plain empty ring when no denominator is measurable', () => {
		mockQuota( { costUsage: 0, costCap: 0, allowanceRemaining: 50000 } );

		const { container } = render( <AiCreditsControl /> );

		expect( container.querySelector( 'svg' ) ).not.toHaveAttribute( 'data-intent' );
		expect( container.querySelector( 'circle:last-child' ) ).toHaveAttribute(
			'stroke-dashoffset',
			'100'
		);
	} );

	it( 'refetches the quota when the menu opens so the balance refreshes', async () => {
		render( <AiCreditsControl /> );

		await openMenu();

		expect( refetchQuota ).toHaveBeenCalled();
	} );

	it( 'opens the WordPress.com checkout from the add-credits item when no priced options exist', async () => {
		render( <AiCreditsControl /> );

		await openMenu();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Add AI credits' } ) );

		expect( openURL ).toHaveBeenCalledWith( getAddAiCreditsUrl( { returnsToDesktop: true } ) );
	} );

	it( 'opens the purchase dialog from the add-credits item when priced options exist', async () => {
		usePricingMock.mockReturnValue( {
			data: { options: [ { credits: 100000, price: 10 } ] },
		} as never );

		render( <AiCreditsControl /> );

		await openMenu();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Add AI credits' } ) );

		await waitFor( () =>
			expect( screen.getByRole( 'dialog' ) ).toHaveTextContent( 'Add AI credits' )
		);
		expect( openURL ).not.toHaveBeenCalled();
	} );
} );
