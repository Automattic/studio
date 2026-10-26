import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { StudioCliSection } from './studio-cli-section';
import type { UserPreferences } from '@/data/core';

async function setup( preferences: Partial< UserPreferences > = {} ) {
	const connector = createFakeConnector( { preferences } );
	renderWithProviders( <StudioCliSection />, { connector } );
	const toggle = await screen.findByRole( 'switch', { name: 'Studio CLI for terminal' } );
	return { connector, toggle };
}

describe( 'Studio CLI setting', () => {
	it( 'shows the change at once and reverts it with an inline error when it fails', async () => {
		const { connector, toggle } = await setup();
		let fail!: ( error: Error ) => void;
		connector.setUserPreferences.mockImplementationOnce(
			() =>
				new Promise( ( _resolve, reject ) => {
					fail = reject;
				} )
		);
		fireEvent.click( toggle );
		expect( toggle ).toBeChecked();
		await waitFor( () => expect( connector.setUserPreferences ).toHaveBeenCalled() );
		await act( async () => fail( new Error( 'Permission denied' ) ) );
		await waitFor( () => expect( toggle ).not.toBeChecked() );
		expect(
			screen.getByText( 'An error occurred while updating the Studio CLI. Please try again.' )
		).toBeVisible();
	} );

	it( 'keeps a standalone CLI read-only', async () => {
		const { connector, toggle } = await setup( {
			studioCliInstalled: true,
			studioCliExternallyManaged: true,
		} );
		expect( toggle ).toBeChecked();
		expect( toggle ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( toggle );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
	} );
} );
