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

	it( 'shows one combined meter across both credit pools', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 25,
				costCap: 1500000,
				allowanceRemaining: 960000,
				purchasedRemaining: 150000,
				purchasedAtTopUp: 500000,
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.getByText( '890,000 of 2,000,000 AI credits used' ) ).toBeInTheDocument();
		expect( screen.getByText( '1,110,000 available' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'ai-credits-meter' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Add AI credits/ } ) ).toBeInTheDocument();
		expect( screen.queryByText( /monthly limit used/ ) ).not.toBeInTheDocument();
	} );

	it( 'welcomes a never-bought account with the allowance size from the quota', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 1500000,
				allowanceRemaining: 1400000,
				purchasedRemaining: 0,
				purchasedAtTopUp: 0,
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.getByText( '100,000 of 1,500,000 AI credits used' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Your first 1,500,000 AI credits are on us.' ) ).toBeInTheDocument();
	} );

	it( 'reads exhausted pools as a full meter with the exhausted callout', () => {
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 25,
				costCap: 1500000,
				allowanceRemaining: 0,
				purchasedRemaining: 0,
				purchasedAtTopUp: 500000,
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.getByText( '2,000,000 of 2,000,000 AI credits used' ) ).toBeInTheDocument();
		expect( screen.getByText( '0 available' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Your next idea is ready when you are. Top up to bring it to life.' )
		).toBeInTheDocument();
	} );

	it( 'falls back to plain known figures when no bar can be drawn', () => {
		// Billing unreachable on an account with no usable free allowance:
		// the purchased balance is unknown, so neither pool has a meter.
		vi.mocked( useGetStudioAssistantQuota, { partial: true } ).mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 0,
				allowanceRemaining: 960000,
				purchasedRemaining: undefined,
				purchasedAtTopUp: 500000,
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} );

		render( <PromptInfo /> );

		expect( screen.getByText( 'Free credits remaining: 960,000' ) ).toBeInTheDocument();
		expect( screen.queryByText( /Purchased credits remaining/ ) ).not.toBeInTheDocument();
		expect( screen.queryByTestId( 'ai-credits-meter' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /Add AI credits/ } ) ).toBeInTheDocument();
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
