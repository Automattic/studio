import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteAgentFiles } from './site-agent-files';

function setup( enabled = true, fail = false ) {
	const file = {
		id: 'studio-cli',
		displayName: 'Studio CLI',
		description: 'CLI workflows',
		installed: true,
		enabled,
	};
	const connector = createFakeConnector(
		{ preferences: { editor: null, terminal: null } as never },
		{
			getSiteAgentFiles: async () => [ { ...file } ],
			setSiteAgentFileEnabled: async ( _siteId, _id, value ) => {
				if ( fail ) {
					throw new Error( 'Could not update skill' );
				}
				file.enabled = value;
			},
			removeSiteAgentFile: async () => {
				file.installed = false;
				file.enabled = false;
			},
		}
	);
	renderWithProviders(
		<SiteAgentFiles site={ makeSite( { id: 'one' } ) } onManageAll={ vi.fn() } />,
		{
			connector,
		}
	);
	return connector;
}

describe( 'site skill rows', () => {
	it( 'turns site skills off and back on without uninstalling their files', async () => {
		const connector = setup();
		fireEvent.click( await screen.findByRole( 'switch', { name: 'WordPress skills' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).not.toBeChecked()
		);
		expect( connector.setSiteAgentFileEnabled ).toHaveBeenCalledWith( 'one', 'studio-cli', false );
		expect( connector.removeSiteAgentFile ).not.toHaveBeenCalled();
		expect( screen.getByRole( 'button', { name: 'Actions for Studio CLI' } ) ).toBeInTheDocument();
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).toBeEnabled()
		);
		fireEvent.click( screen.getByRole( 'switch', { name: 'WordPress skills' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).toBeChecked()
		);
		expect( connector.setSiteAgentFileEnabled ).toHaveBeenLastCalledWith(
			'one',
			'studio-cli',
			true
		);
	} );

	it( 'disables and restores a skill without removing it', async () => {
		const connector = setup();
		fireEvent.click( await screen.findByRole( 'switch', { name: 'Studio CLI' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).not.toBeChecked()
		);
		expect( connector.setSiteAgentFileEnabled ).toHaveBeenCalledWith( 'one', 'studio-cli', false );
		expect( connector.removeSiteAgentFile ).not.toHaveBeenCalled();
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).toBeEnabled()
		);
		fireEvent.click( screen.getByRole( 'switch', { name: 'Studio CLI' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).toBeChecked()
		);
		expect( connector.setSiteAgentFileEnabled ).toHaveBeenLastCalledWith(
			'one',
			'studio-cli',
			true
		);
	} );

	it.each( [
		[ 'Visual Studio Code', 'editor' ],
		[ 'Finder', 'files' ],
		[ 'Terminal', 'terminal' ],
	] )( 'opens the disabled skill in %s', async ( label, target ) => {
		const connector = setup( false );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Studio CLI' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: label } ) );
		await waitFor( () =>
			expect( connector.openSiteAgentFile ).toHaveBeenCalledWith( 'one', 'studio-cli', target )
		);
	} );

	it( 'omits phpMyAdmin and unavailable editors from the open menu', async () => {
		const connector = setup();
		connector.getInstalledApps.mockResolvedValue( {} as never );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Studio CLI' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		await screen.findByRole( 'menuitem', { name: 'Finder' } );
		expect(
			screen.queryByRole( 'menuitem', { name: 'Visual Studio Code' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'menuitem', { name: 'phpMyAdmin' } ) ).not.toBeInTheDocument();
	} );

	it( 'only removes files through the explicit menu action', async () => {
		const connector = setup( false );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for Studio CLI' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Uninstall' } ) );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Actions for Studio CLI' } )
			).not.toBeInTheDocument()
		);
		expect( connector.removeSiteAgentFile ).toHaveBeenCalledWith( 'one', 'studio-cli' );
		expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).not.toBeChecked();
	} );

	it( 'keeps the original state and shows an error when updating fails', async () => {
		setup( true, true );
		fireEvent.click( await screen.findByRole( 'switch', { name: 'Studio CLI' } ) );
		await screen.findByText( 'Could not update skill' );
		expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).toBeChecked();
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).toBeEnabled()
		);
	} );
} );
