import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteAgentFiles } from './site-agent-files';

function setup( enabled = true ) {
	const file = {
		id: 'AGENTS.md',
		displayName: 'AGENTS.md',
		description: 'Instructions for AI agents.',
		installed: true,
		enabled,
	};
	const connector = createFakeConnector(
		{ preferences: { editor: null, terminal: null } as never },
		{
			getSiteAgentFiles: async () => [ { ...file } ],
			setSiteAgentFileEnabled: async ( _siteId, _kind, _id, value ) => {
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
		{ connector }
	);
	return connector;
}

describe( 'site instruction rows', () => {
	it( 'turns instructions off and back on without uninstalling their files', async () => {
		const connector = setup();
		fireEvent.click( await screen.findByRole( 'switch', { name: 'Agent instructions' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'AGENTS.md' } ) ).not.toBeChecked()
		);
		expect( connector.setSiteAgentFileEnabled ).toHaveBeenCalledWith(
			'one',
			'instructions',
			'AGENTS.md',
			false
		);
		expect( connector.removeSiteAgentFile ).not.toHaveBeenCalled();
	} );

	it( 'opens a switched-off file in Finder', async () => {
		const connector = setup( false );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for AGENTS.md' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Open in' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Finder' } ) );
		await waitFor( () =>
			expect( connector.openSiteAgentFile ).toHaveBeenCalledWith(
				'one',
				'instructions',
				'AGENTS.md',
				'files'
			)
		);
	} );

	it( 'only removes files through the explicit menu action', async () => {
		const connector = setup( false );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Actions for AGENTS.md' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Uninstall' } ) );
		await waitFor( () =>
			expect( connector.removeSiteAgentFile ).toHaveBeenCalledWith(
				'one',
				'instructions',
				'AGENTS.md'
			)
		);
	} );

	it( 'links to the instructions documentation', async () => {
		const connector = setup();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Learn more…' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.studio/docs/cli/'
		);
	} );
} );
