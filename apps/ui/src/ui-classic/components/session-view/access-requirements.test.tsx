import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useConnector } from '@/data/core';
import { AccessRequirements } from './access-requirements';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

describe( 'AccessRequirements', () => {
	const openExternalUrl = vi.fn().mockResolvedValue( undefined );

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( { openExternalUrl } );
	} );

	it( 'shows the payment requirement and hands off to the browser', async () => {
		const user = userEvent.setup();
		render( <AccessRequirements isRechecking={ false } onRecheck={ vi.fn() } /> );

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
		render( <AccessRequirements isRechecking={ false } onRecheck={ onRecheck } /> );

		await user.click( screen.getByRole( 'button', { name: 'Add payment method' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Check again' } ) );
		expect( onRecheck ).toHaveBeenCalledTimes( 1 );

		await user.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect( screen.getByText( 'Studio Code Beta' ) ).toBeInTheDocument();
	} );

	it( 'labels the recheck button while a recheck is in flight', async () => {
		const user = userEvent.setup();
		render( <AccessRequirements isRechecking={ true } onRecheck={ vi.fn() } /> );

		await user.click( screen.getByRole( 'button', { name: 'Add payment method' } ) );
		expect( screen.getByRole( 'button', { name: 'Checking…' } ) ).toBeInTheDocument();
	} );
} );
