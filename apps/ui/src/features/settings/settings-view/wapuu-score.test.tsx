import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { WapuuScore } from './wapuu-score';

describe( 'Wapuu score', () => {
	it( 'stays hidden until a score has been recorded', async () => {
		const { connector } = renderWithProviders( <WapuuScore /> );
		await waitFor( () => expect( connector.getWapuuScore ).toHaveBeenCalled() );
		expect( screen.queryByRole( 'progressbar' ) ).not.toBeInTheDocument();
	} );

	it( 'shows the score and opens wapuu.studio', async () => {
		const connector = createFakeConnector( {}, { getWapuuScore: async () => 1200 } );
		renderWithProviders( <WapuuScore />, { connector } );
		expect( await screen.findByRole( 'progressbar', { name: 'Wapuu score' } ) ).toHaveAttribute(
			'aria-valuenow',
			'1200'
		);
		expect( screen.getByText( /1200 of \d+ points/ ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Visit wapuu.studio' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://wapuu.studio' );
	} );
} );
