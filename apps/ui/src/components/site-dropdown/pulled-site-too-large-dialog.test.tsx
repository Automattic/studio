import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PulledSiteTooLargeDialog } from './pulled-site-too-large-dialog';

describe( 'PulledSiteTooLargeDialog', () => {
	it( 'names the limit and hedges, since the tally is of uncompressed files', () => {
		render( <PulledSiteTooLargeDialog open onOpenChange={ vi.fn() } /> );

		expect( screen.getByText( /over 5 GB/ ) ).toBeInTheDocument();
		expect( screen.getByText( /may prevent you from pushing it back/ ) ).toBeInTheDocument();
	} );

	it( 'only dismisses, since the pull has already finished', async () => {
		const onOpenChange = vi.fn();
		render( <PulledSiteTooLargeDialog open onOpenChange={ onOpenChange } /> );

		expect( screen.queryByRole( 'button', { name: /cancel/i } ) ).not.toBeInTheDocument();
		await userEvent.click( screen.getByRole( 'button', { name: 'Got it' } ) );

		expect( onOpenChange.mock.calls[ 0 ][ 0 ] ).toBe( false );
	} );

	it( 'renders nothing while closed', () => {
		render( <PulledSiteTooLargeDialog open={ false } onOpenChange={ vi.fn() } /> );

		expect( screen.queryByText( /over 5 GB/ ) ).not.toBeInTheDocument();
	} );
} );
