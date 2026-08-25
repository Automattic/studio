import '@testing-library/jest-dom/vitest';
import { ADD_AI_CREDITS_URL } from '@studio/common/lib/studio-assistant-quota';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { AiCreditsControl } from './ai-credits-control';

const { navigateMock, openExternalUrl } = vi.hoisted( () => ( {
	navigateMock: vi.fn(),
	openExternalUrl: vi.fn(),
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( { openExternalUrl } ),
} ) );

vi.mock( '@/data/queries/use-assistant-quota', () => ( {
	ASSISTANT_QUOTA_QUERY_KEY: [ 'assistant-quota' ],
	useStudioAssistantQuota: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: () => 'en',
} ) );

vi.mock( '@/components/ai-credits-details-dialog', () => ( {
	AiCreditsDetailsDialog: ( { open }: { open: boolean } ) =>
		open ? <div role="dialog">How AI credits work</div> : null,
} ) );

const useStudioAssistantQuotaMock = vi.mocked( useStudioAssistantQuota );

function renderControl( queryClient = new QueryClient() ) {
	return render(
		<QueryClientProvider client={ queryClient }>
			<Tooltip.Provider delay={ 0 }>
				<AiCreditsControl />
			</Tooltip.Provider>
		</QueryClientProvider>
	);
}

async function openMenu() {
	fireEvent.click( screen.getByRole( 'button', { name: 'AI credits' } ) );
	await waitFor( () => expect( screen.getAllByRole( 'menuitem' ).length ).toBe( 3 ) );
}

describe( 'AiCreditsControl', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 0,
				allowanceRemaining: 960000,
				purchasedRemaining: 150000,
			},
		} as never );
	} );

	it( 'renders nothing when the quota has no per-pool balance fields', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 25, costCap: 100, costResetDate: '2026-08-01T12:00:00' },
		} as never );

		const { container } = renderControl();

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing while the quota is still unknown', () => {
		useStudioAssistantQuotaMock.mockReturnValue( { data: undefined } as never );

		const { container } = renderControl();

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing for an account without Studio Code AI access', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 0,
				studioCodeAiHasAccess: false,
				studioCodeAiAccess: 'blocked',
				allowanceRemaining: 960000,
				purchasedRemaining: 0,
			},
		} as never );

		const { container } = renderControl();

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'sums the allowance and purchased pools in the menu summary', async () => {
		renderControl();

		await openMenu();

		expect( screen.getByText( '1,110,000 remaining' ) ).toBeInTheDocument();
	} );

	it( 'shows the plenty state from the combined balance, regardless of the legacy quota usage', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 100,
				costCap: 100,
				allowanceRemaining: 0,
				purchasedRemaining: 150000,
			},
		} as never );

		const { container } = renderControl();
		const ring = container.querySelector( 'svg' );

		expect( ring ).toBeInTheDocument();
		expect( ring ).not.toHaveAttribute( 'data-caution' );
		expect( ring ).not.toHaveAttribute( 'data-exhausted' );
		expect( container.querySelector( 'circle:last-child' ) ).toHaveAttribute(
			'stroke-dashoffset',
			'40'
		);
	} );

	it( 'shows the low state when the combined balance reaches 100,000 credits', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 0,
				allowanceRemaining: 70000,
				purchasedRemaining: 30000,
			},
		} as never );

		const { container } = renderControl();
		const ring = container.querySelector( 'svg' );

		expect( ring ).toHaveAttribute( 'data-caution', 'true' );
		expect( ring ).not.toHaveAttribute( 'data-exhausted' );
		expect( container.querySelector( 'circle:last-child' ) ).toHaveAttribute(
			'stroke-dashoffset',
			'30'
		);
	} );

	it( 'keeps the plenty state above the low-credit boundary', () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 0,
				allowanceRemaining: 100001,
				purchasedRemaining: 0,
			},
		} as never );

		const { container } = renderControl();

		expect( container.querySelector( 'svg' ) ).not.toHaveAttribute( 'data-caution' );
	} );

	it.each( [
		[ 1_000_001, '100' ],
		[ 1_000_000, '90' ],
		[ 750_000, '80' ],
		[ 500_000, '70' ],
		[ 375_000, '60' ],
		[ 250_000, '50' ],
		[ 175_000, '40' ],
		[ 100_000, '30' ],
		[ 75_000, '20' ],
		[ 50_000, '10' ],
		[ 0, '0' ],
	] )( 'shows the expected ring step at %i remaining credits', ( remaining, dashOffset ) => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 0,
				costCap: 0,
				allowanceRemaining: remaining,
				purchasedRemaining: 0,
			},
		} as never );

		const { container } = renderControl();

		expect( container.querySelector( 'circle:last-child' ) ).toHaveAttribute(
			'stroke-dashoffset',
			dashOffset
		);
	} );

	it( 'shows the summed balance even when both pools are exhausted', async () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 0, costCap: 0, allowanceRemaining: 0, purchasedRemaining: 0 },
		} as never );

		renderControl();

		await openMenu();

		expect( screen.getByText( 'No AI credits remaining' ) ).toBeInTheDocument();
	} );

	it( 'shows the out state when the combined balance is empty', async () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 100, costCap: 100, allowanceRemaining: 0, purchasedRemaining: 0 },
		} as never );
		const { container } = renderControl();

		await openMenu();

		expect( screen.getByText( 'No AI credits remaining' ) ).toBeInTheDocument();
		expect( container.querySelector( 'svg' ) ).toHaveAttribute( 'data-exhausted', 'true' );
		expect( container.querySelector( 'circle:last-child' ) ).toHaveAttribute(
			'stroke-dashoffset',
			'0'
		);
	} );

	it( 'shows a compact balance in the tooltip', async () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: {
				costUsage: 25,
				costCap: 100,
				allowanceRemaining: 800000,
				purchasedRemaining: 32500,
			},
		} as never );
		renderControl();

		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'AI credits' } ) );

		expect( await screen.findByText( 'AI credits · 832.5K remaining' ) ).toBeInTheDocument();
	} );

	it( 'shows an out-of-credits tooltip when the combined balance is empty', async () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 100, costCap: 100, allowanceRemaining: 0, purchasedRemaining: 0 },
		} as never );
		renderControl();

		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'AI credits' } ) );

		expect( await screen.findByText( 'AI credits · Out of credits' ) ).toBeInTheDocument();
	} );

	it( 'opens the WordPress.com checkout from the add-credits item', async () => {
		renderControl();

		await openMenu();
		fireEvent.click( screen.getByRole( 'menuitem', { name: /Add AI credits/ } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith( ADD_AI_CREDITS_URL );
	} );

	it( 'opens the credits explainer dialog from the menu', async () => {
		renderControl();

		await openMenu();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'How AI credits work' } ) );

		await waitFor( () =>
			expect( screen.getByRole( 'dialog' ) ).toHaveTextContent( 'How AI credits work' )
		);
	} );

	it( 'marks the quota stale when the menu opens so the balance refreshes', async () => {
		const queryClient = new QueryClient();
		const invalidateSpy = vi.spyOn( queryClient, 'invalidateQueries' );

		renderControl( queryClient );

		await openMenu();

		expect( invalidateSpy ).toHaveBeenCalledWith( { queryKey: [ 'assistant-quota' ] } );
	} );

	it( 'navigates to the usage settings tab from the menu', async () => {
		renderControl();

		await openMenu();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Usage settings' } ) );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/settings',
			search: { tab: 'usage' },
		} );
	} );
} );
