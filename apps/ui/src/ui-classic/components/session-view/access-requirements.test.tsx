import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useConnector } from '@/data/core';
import { AccessRequirements } from './access-requirements';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

const grantedQuota = {
	costUsage: 0,
	studioCodeAiHasAccess: true,
	studioCodeAiAccess: 'granted',
};

const notEnabledQuota = {
	costUsage: 0,
	studioCodeAiHasAccess: false,
	studioCodeAiAccess: 'default',
};

describe( 'AccessRequirements', () => {
	const openExternalUrl = vi.fn().mockResolvedValue( undefined );

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( { openExternalUrl } );
	} );

	it( 'shows the payment requirement and hands off to the browser', async () => {
		const user = userEvent.setup();
		render(
			<AccessRequirements quota={ grantedQuota } isRechecking={ false } onRecheck={ vi.fn() } />
		);

		expect( screen.getByText( 'Studio Code Beta' ) ).toBeInTheDocument();
		expect( screen.getByText( 'You won’t be charged during the beta.' ) ).toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name: 'Add payment method' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://my.wordpress.com/me/billing/payment-methods/add'
		);
		expect( screen.getByText( 'Finish adding your payment method' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Check again' } ) ).toBeInTheDocument();
	} );

	it( 'rechecks from the waiting state and can go back', async () => {
		const user = userEvent.setup();
		const onRecheck = vi.fn();
		render(
			<AccessRequirements quota={ grantedQuota } isRechecking={ false } onRecheck={ onRecheck } />
		);

		await user.click( screen.getByRole( 'button', { name: 'Add payment method' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Check again' } ) );
		expect( onRecheck ).toHaveBeenCalledTimes( 1 );

		await user.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect( screen.getByText( 'Studio Code Beta' ) ).toBeInTheDocument();
	} );

	it( 'labels the recheck button while a recheck is in flight', async () => {
		const user = userEvent.setup();
		render(
			<AccessRequirements quota={ grantedQuota } isRechecking={ true } onRecheck={ vi.fn() } />
		);

		await user.click( screen.getByRole( 'button', { name: 'Add payment method' } ) );
		expect( screen.getByRole( 'button', { name: 'Checking…' } ) ).toBeInTheDocument();
	} );

	it( 'asks an ungranted account to apply for beta access, even without a payment method', async () => {
		const user = userEvent.setup();
		render(
			<AccessRequirements quota={ notEnabledQuota } isRechecking={ false } onRecheck={ vi.fn() } />
		);

		expect(
			screen.getByText( 'Studio Code AI is currently available through limited beta access.' )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Add payment method' } )
		).not.toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name: 'Apply for access' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/studio/studio-code-beta/'
		);
		expect( screen.getByText( 'Finish applying for access' ) ).toBeInTheDocument();
	} );

	it( 'tells an ungranted account with spend this cycle that access is now limited', () => {
		render(
			<AccessRequirements
				quota={ { ...notEnabledQuota, costUsage: 3 } }
				isRechecking={ false }
				onRecheck={ vi.fn() }
			/>
		);

		expect(
			screen.getByText(
				'Thanks for participating in the Studio Code AI beta. Access is now limited.'
			)
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Apply for access' } ) ).toBeInTheDocument();
	} );

	it( 'shows the suspension copy with a support link for a blocked account', async () => {
		const user = userEvent.setup();
		render(
			<AccessRequirements
				quota={ { ...notEnabledQuota, studioCodeAiAccess: 'blocked' } }
				isRechecking={ false }
				onRecheck={ vi.fn() }
			/>
		);

		expect(
			screen.getByText( /Studio Code AI is blocked for this WordPress.com account/ )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Apply for access' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Add payment method' } )
		).not.toBeInTheDocument();

		await user.click( screen.getByRole( 'button', { name: 'Contact support' } ) );
		expect( openExternalUrl ).toHaveBeenCalledWith( 'https://wordpress.com/support/contact/' );
	} );
} );
