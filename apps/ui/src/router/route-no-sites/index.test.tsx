import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

describe( 'the empty workspace', () => {
	it( 'leaves Add site to the welcome, which opens it itself', async () => {
		renderApp( { path: '/sites?welcome=true' } );
		expect(
			await screen.findByRole( 'dialog', { name: 'Welcome to WordPress Studio' } )
		).toBeVisible();
		expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument();
	} );

	it( 'offers Add site, then leaves for a site that appears', async () => {
		const connector = createFakeConnector();
		const { history, user } = renderApp( { connector, path: '/sites' } );
		expect( await screen.findByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
		await user.keyboard( '{Escape}' );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Add site' } ) ).not.toBeInTheDocument()
		);

		await connector.createSite( { name: 'From the terminal', path: '/sites/from-cli' } );

		await waitFor( () => expect( history.location.pathname ).not.toBe( '/sites' ) );
	} );
} );
