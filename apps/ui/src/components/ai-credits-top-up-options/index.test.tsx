import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { AiCreditsTopUpOptions } from './index';
import type { StudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/ui', () => ( {
	Button: Object.assign(
		( {
			children,
			tone,
			variant,
			size,
			...props
		}: ButtonHTMLAttributes< HTMLButtonElement > & {
			children?: ReactNode;
			tone?: string;
			variant?: string;
			size?: string;
		} ) => {
			void tone;
			void variant;
			void size;
			return <button { ...props }>{ children }</button>;
		},
		{ Icon: () => null }
	),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-top-up-pricing', () => ( {
	useStudioAssistantTopUpPricing: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-app-globals', () => ( {
	useAppGlobals: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const usePricingMock = vi.mocked( useStudioAssistantTopUpPricing );
const useUserLocaleMock = vi.mocked( useUserLocale );
const useAppGlobalsMock = vi.mocked( useAppGlobals );

// The four options the endpoint documents, in a currency whose price can't be
// derived from the minor units — the label must echo `display` verbatim.
const gbpPricing: StudioAssistantTopUpPricing = {
	currency: 'GBP',
	step: { credits: 10000, amountMinor: 75, display: '£0.75' },
	options: [
		{ credits: 100000, amountMinor: 750, display: '£7.50' },
		{ credits: 200000, amountMinor: 1500, display: '£15' },
		{ credits: 500000, amountMinor: 3750, display: '£37.50' },
		{ credits: 1000000, amountMinor: 7500, display: '£75' },
	],
};

function mockPricing( data: StudioAssistantTopUpPricing | null, isLoading = false ) {
	usePricingMock.mockReturnValue( { data, isLoading } as ReturnType<
		typeof useStudioAssistantTopUpPricing
	> );
}

describe( 'AiCreditsTopUpOptions', () => {
	const openExternalUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( { openExternalUrl } as unknown as ReturnType<
			typeof useConnector
		> );
		useUserLocaleMock.mockReturnValue( 'en' );
		useAppGlobalsMock.mockReturnValue( { data: { platform: 'browser' } } as ReturnType<
			typeof useAppGlobals
		> );
	} );

	it( 'renders a button per priced option, showing the store’s price', () => {
		mockPricing( gbpPricing );
		render( <AiCreditsTopUpOptions /> );

		expect( screen.getAllByRole( 'button' ).map( ( button ) => button.textContent ) ).toEqual( [
			'100,000 credits · £7.50',
			'200,000 credits · £15',
			'500,000 credits · £37.50',
			'1,000,000 credits · £75',
		] );
	} );

	it( 'buys the quantity the clicked option names', () => {
		mockPricing( gbpPricing );
		render( <AiCreditsTopUpOptions /> );

		fireEvent.click( screen.getByText( '500,000 credits · £37.50' ) );
		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.com/checkout/wpcom/studio-code-ai-credits:-q-500000'
		);
	} );

	it( 'renders however many options came back', () => {
		mockPricing( { ...gbpPricing, options: gbpPricing.options.slice( 0, 2 ) } );
		render( <AiCreditsTopUpOptions /> );

		expect( screen.getAllByRole( 'button' ) ).toHaveLength( 2 );
	} );

	it( 'falls back to the single fixed top-up when pricing is unavailable', () => {
		mockPricing( { currency: 'GBP', options: [], step: null } );
		render( <AiCreditsTopUpOptions /> );

		const button = screen.getByRole( 'button' );
		expect( button ).toHaveTextContent( 'Add AI credits' );
		fireEvent.click( button );
		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.com/checkout/wpcom/studio-code-ai-credits:-q-100000'
		);
	} );

	it( 'falls back the same way when pricing could not be fetched at all', () => {
		mockPricing( null );
		render( <AiCreditsTopUpOptions /> );

		expect( screen.getByRole( 'button' ) ).toHaveTextContent( 'Add AI credits' );
	} );

	it( 'offers nothing to click while the prices are still loading', () => {
		mockPricing( undefined as unknown as null, true );
		render( <AiCreditsTopUpOptions /> );

		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
} );
