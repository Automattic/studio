import '@testing-library/jest-dom/vitest';
import { ADD_AI_CREDITS_URL } from '@studio/common/lib/studio-assistant-quota';
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

function renderControl() {
	return render(
		<Tooltip.Provider delay={ 0 }>
			<AiCreditsControl />
		</Tooltip.Provider>
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

	it( 'shows the summed balance even when both pools are exhausted', async () => {
		useStudioAssistantQuotaMock.mockReturnValue( {
			data: { costUsage: 0, costCap: 0, allowanceRemaining: 0, purchasedRemaining: 0 },
		} as never );

		renderControl();

		await openMenu();

		expect( screen.getByText( '0 remaining' ) ).toBeInTheDocument();
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
