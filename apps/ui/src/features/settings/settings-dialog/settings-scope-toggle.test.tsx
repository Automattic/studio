import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

describe( 'Settings scope toggle', () => {
	it( 'switches on selection and blocks switching when disabled', async () => {
		const withSite = renderApp( {
			connector: createFakeConnector( { sites: [ makeSite( { id: 'one' } ) ] } ),
			path: '/sites/one?settings=general',
		} );
		const enabled = await screen.findByRole( 'tab', { name: 'Site' } );
		await waitFor( () => expect( enabled ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
		fireEvent.click( enabled );
		await waitFor( () => expect( withSite.history.location.search ).toContain( 'settings=site' ) );
		withSite.unmount();

		const withoutSite = renderApp( { path: '/?settings=general' } );
		const site = await screen.findByRole( 'tab', { name: 'Site' } );
		expect( site ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( site );
		expect( withoutSite.history.location.search ).toContain( 'settings=general' );
		expect( screen.getByRole( 'tab', { name: 'Studio' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
	} );
} );
