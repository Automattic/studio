import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { AiCreditsPurchaseDialog } from './index';
import type { StudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';

vi.mock( '@/data/core', () => ( { useConnector: vi.fn() } ) );
vi.mock( '@/data/queries/use-top-up-pricing', () => ( {
	useStudioAssistantTopUpPricing: vi.fn(),
} ) );
vi.mock( '@/data/queries/use-user-locale', () => ( { useUserLocale: vi.fn() } ) );
vi.mock( '@/data/queries/use-app-globals', () => ( { useAppGlobals: vi.fn() } ) );

const useConnectorMock = vi.mocked( useConnector );
const usePricingMock = vi.mocked( useStudioAssistantTopUpPricing );
const useUserLocaleMock = vi.mocked( useUserLocale );
const useAppGlobalsMock = vi.mocked( useAppGlobals );

// A currency whose price can't be reconstructed from the minor units — the
// cards must echo `display` rather than compute anything.
const gbpPricing: StudioAssistantTopUpPricing = {
	options: [
		{ credits: 100000, display: '£7.50' },
		{ credits: 200000, display: '£15' },
		{ credits: 500000, display: '£37.50' },
		{ credits: 1000000, display: '£75' },
	],
};

describe( 'AiCreditsPurchaseDialog', () => {
	const openExternalUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( { openExternalUrl } as never );
		useUserLocaleMock.mockReturnValue( 'en' );
		useAppGlobalsMock.mockReturnValue( { data: { platform: 'browser' } } as never );
		usePricingMock.mockReturnValue( { data: gbpPricing, isLoading: false } as never );
	} );

	function renderDialog() {
		return render( <AiCreditsPurchaseDialog open onOpenChange={ vi.fn() } /> );
	}

	it( 'offers a card per priced amount, showing the store’s price', () => {
		renderDialog();

		expect( screen.getByText( 'one-time' ).tagName ).toBe( 'STRONG' );
		expect( screen.getByText( '£7.50' ) ).toBeInTheDocument();
		expect( screen.getByText( '100,000 credits' ) ).toBeInTheDocument();
		expect( screen.getAllByRole( 'radio' ) ).toHaveLength( 4 );
	} );

	it( 'preselects the cheapest amount and names its price on the button', () => {
		renderDialog();

		expect( screen.getByRole( 'radio', { name: /100,000 credits/ } ) ).toBeChecked();
		expect( screen.getByRole( 'button', { name: 'Continue for £7.50' } ) ).toBeInTheDocument();
	} );

	it( 'moves keyboard focus into the dialog when it opens', async () => {
		renderDialog();

		await waitFor( () => {
			expect( screen.getByRole( 'radio', { name: /100,000 credits/ } ) ).toHaveFocus();
		} );
	} );

	it( 'uses one tab stop and arrow keys to move through the radio group', () => {
		renderDialog();
		const radios = screen.getAllByRole( 'radio' );

		expect( radios.map( ( radio ) => radio.tabIndex ) ).toEqual( [ 0, -1, -1, -1 ] );
		fireEvent.keyDown( radios[ 0 ], { key: 'ArrowLeft' } );
		expect( radios[ 3 ] ).toBeChecked();
		expect( radios[ 3 ] ).toHaveFocus();
		expect( radios.map( ( radio ) => radio.tabIndex ) ).toEqual( [ -1, -1, -1, 0 ] );
	} );

	it( 'follows the selection, and checks out the amount that is selected', () => {
		renderDialog();

		fireEvent.click( screen.getByRole( 'radio', { name: /500,000 credits/ } ) );
		expect( screen.getByRole( 'button', { name: 'Continue for £37.50' } ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Continue for £37.50' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.com/checkout/wpcom/studio-code-ai-credits:-q-500000'
		);
	} );

	it( 'renders however many amounts came back', () => {
		usePricingMock.mockReturnValue( {
			data: { ...gbpPricing, options: gbpPricing.options.slice( 0, 2 ) },
			isLoading: false,
		} as never );

		renderDialog();

		expect( screen.getAllByRole( 'radio' ) ).toHaveLength( 2 );
	} );

	it( 'cannot check out when nothing could be priced', () => {
		usePricingMock.mockReturnValue( {
			data: { options: [] },
			isLoading: false,
		} as never );

		renderDialog();

		expect( screen.queryAllByRole( 'radio' ) ).toHaveLength( 0 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		expect( openExternalUrl ).not.toHaveBeenCalled();
	} );
} );
