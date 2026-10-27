import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

describe( 'operation errors', () => {
	it( 'preserves ordinary validation errors', async () => {
		const connector = createFakeConnector( { sites: [ makeSite( { id: 'one', name: 'One' } ) ] } );
		connector.startSite.mockRejectedValue( new Error( 'Choose an empty folder.' ) );
		const { user, history } = renderApp( { connector } );
		await waitFor( () => expect( history.location.pathname ).toContain( 'one' ) );
		await user.click( await screen.findByRole( 'button', { name: 'Start One' } ) );
		await waitFor( () =>
			expect( getVisibleToasts().map( ( toast ) => toast.description ) ).toEqual( [
				'Choose an empty folder.',
			] )
		);
	} );
} );
