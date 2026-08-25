import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { useOffline } from 'src/hooks/use-offline';
import { PromptInfo } from 'src/modules/user-settings/components/prompt-info';
import {
	useGetStudioAssistantQuota,
	useGetStudioAssistantTopUpPricing,
} from 'src/stores/wpcom-api';
import type { StudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';

vi.mock( 'src/hooks/use-offline' );

vi.mock( 'src/stores', () => ( {
	useI18nLocale: vi.fn( () => 'en-US' ),
} ) );

vi.mock( 'src/stores/wpcom-api', () => ( {
	useGetStudioAssistantQuota: vi.fn(),
	useGetStudioAssistantTopUpPricing: vi.fn(),
} ) );

function mockTopUpPricing( pricing: StudioAssistantTopUpPricing | null, isLoading = false ) {
	vi.mocked( useGetStudioAssistantTopUpPricing, { partial: true } ).mockReturnValue( {
		data: pricing,
		isLoading,
	} );
}

describe( 'PromptInfo', () => {
	beforeEach( () => {
		vi.mocked( useOffline ).mockReturnValue( false );
		mockTopUpPricing( null );
	} );

	it( 'shows Studio Code dollar usage and reset date', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 33392,
				costCap: 20000000,
				costResetDate: '2026-07-01T00:00:00+00:00',
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.getByText( 'Studio Code' ) ).toBeInTheDocument();
		expect(
			screen.getByText( '0.17% of monthly limit used (resets on July 1, 2026)' )
		).toBeInTheDocument();
		expect( screen.queryByText( /monthly prompts used/ ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'progressbar' ) ).toBeInTheDocument();
	} );

	it( 'drops the reset sentence when the server no longer reports a reset date', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 33392,
				costCap: 20000000,
				costResetDate: undefined,
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.getByText( '0.17% of monthly limit used' ) ).toBeInTheDocument();
		expect( screen.queryByText( /resets on/ ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'progressbar' ) ).toBeInTheDocument();
	} );

	it( 'shows both credit balances when the account has AI credits', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 33392,
				costCap: 20000000,
				costResetDate: '2026-07-01T00:00:00+00:00',
				allowanceRemaining: 960000,
				purchasedRemaining: 150000,
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.getByText( 'Free credits remaining: 960,000' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Purchased credits remaining: 150,000' ) ).toBeInTheDocument();
		expect( screen.queryByText( /monthly limit used/ ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'progressbar' ) ).not.toBeInTheDocument();
	} );

	it( 'offers a button per top-up the store priced, and only the fixed one without pricing', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 33392,
				costCap: 20000000,
				allowanceRemaining: 960000,
				purchasedRemaining: 150000,
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		const { unmount } = render( <PromptInfo /> );
		expect( screen.getByRole( 'button', { name: 'Add AI credits' } ) ).toBeInTheDocument();
		unmount();

		mockTopUpPricing( {
			currency: 'GBP',
			step: null,
			options: [
				{ credits: 100000, amountMinor: 750, display: '£7.50' },
				{ credits: 500000, amountMinor: 3750, display: '£37.50' },
			],
		} );
		render( <PromptInfo /> );

		expect( screen.getByText( '100,000 · £7.50' ) ).toBeInTheDocument();
		expect( screen.getByText( '500,000 · £37.50' ) ).toBeInTheDocument();
	} );

	it( 'hides the free pool once it is spent, and keeps a zero purchased balance', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 33392,
				costCap: 20000000,
				costResetDate: '2026-07-01T00:00:00+00:00',
				allowanceRemaining: 0,
				purchasedRemaining: 0,
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.queryByText( /Free credits remaining/ ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Purchased credits remaining: 0' ) ).toBeInTheDocument();
	} );

	it( 'keeps the monthly limit design when the account has no AI credits', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 33392,
				costCap: 20000000,
				costResetDate: '2026-07-01T00:00:00+00:00',
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.queryByText( /credits remaining/ ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( '0.17% of monthly limit used (resets on July 1, 2026)' )
		).toBeInTheDocument();
	} );

	it( 'shows unavailable message when cost cap is missing', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 0,
				costResetDate: '2026-07-01T00:00:00+00:00',
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect(
			screen.getByText( 'Studio Code limits are temporarily unavailable.' )
		).toBeInTheDocument();
	} );

	it( 'caps over-limit usage at 100%', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 3403700000,
				costCap: 20000000,
				costResetDate: '2026-07-01T00:00:00+00:00',
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect(
			screen.getByText( '100% of monthly limit used (resets on July 1, 2026)' )
		).toBeInTheDocument();
	} );
} );
