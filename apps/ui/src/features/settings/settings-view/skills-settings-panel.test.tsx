import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SkillsPanel } from './skills-panel';

function setup( installed = false, failInstall = false ) {
	const skills = [
		{
			id: 'studio-cli',
			displayName: 'WordPress Studio CLI',
			description: 'CLI workflows',
			installed,
		},
		{
			id: 'wp-plugin-development',
			displayName: 'Plugin Development',
			description: 'Plugins',
			installed,
		},
	];
	const connector = createFakeConnector(
		{},
		{
			getWordPressSkillsStatusAllSites: async () => skills.map( ( skill ) => ( { ...skill } ) ),
			installWordPressSkillToAllSites: async ( id: string ) => {
				if ( failInstall ) {
					throw new Error( 'Installation failed' );
				}
				skills.find( ( skill ) => skill.id === id )!.installed = true;
			},
			removeWordPressSkillFromAllSites: async ( id: string ) => {
				skills.find( ( skill ) => skill.id === id )!.installed = false;
			},
		}
	);
	renderWithProviders( <SkillsPanel />, { connector } );
	return connector;
}

describe( 'App skills selection', () => {
	it( 'installs every skill and keeps individual choices visible', async () => {
		const connector = setup();
		fireEvent.click( await screen.findByRole( 'switch', { name: 'WordPress skills' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).toBeChecked()
		);
		expect( connector.installWordPressSkillToAllSites.mock.calls ).toEqual( [
			[ 'studio-cli' ],
			[ 'wp-plugin-development' ],
		] );
		expect( screen.getByRole( 'switch', { name: 'WordPress Studio CLI' } ) ).toBeChecked();
		expect( screen.getByRole( 'switch', { name: 'Plugin Development' } ) ).toBeChecked();
	} );

	it( 'keeps the main toggle on while any individual skill remains installed', async () => {
		const connector = setup( true );
		await screen.findByRole( 'switch', { name: 'WordPress skills' } );
		fireEvent.click( screen.getByRole( 'switch', { name: 'WordPress Studio CLI' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'WordPress Studio CLI' } ) ).not.toBeChecked()
		);
		expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).toBeChecked();
		expect( connector.removeWordPressSkillFromAllSites ).toHaveBeenCalledWith( 'studio-cli' );
		expect( screen.getByRole( 'switch', { name: 'Plugin Development' } ) ).toBeChecked();
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'WordPress Studio CLI' } ) ).toBeEnabled()
		);
		fireEvent.click( screen.getByRole( 'switch', { name: 'WordPress Studio CLI' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).toBeChecked()
		);
	} );

	it( 'removes every skill when the main toggle is turned off', async () => {
		const connector = setup( true );
		fireEvent.click( await screen.findByRole( 'switch', { name: 'WordPress skills' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).not.toBeChecked()
		);
		expect( connector.removeWordPressSkillFromAllSites.mock.calls ).toEqual( [
			[ 'studio-cli' ],
			[ 'wp-plugin-development' ],
		] );
		expect(
			screen.queryByRole( 'switch', { name: 'WordPress Studio CLI' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'switch', { name: 'Plugin Development' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the main toggle available after installation fails', async () => {
		setup( false, true );
		fireEvent.click( await screen.findByRole( 'switch', { name: 'WordPress skills' } ) );
		await screen.findByText( 'Installation failed' );
		expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).not.toBeChecked();
		expect(
			screen.queryByRole( 'switch', { name: 'WordPress Studio CLI' } )
		).not.toBeInTheDocument();
	} );

	it( 'opens the Studio skills documentation from the skills fieldset', async () => {
		const connector = setup( true );
		for ( const link of await screen.findAllByRole( 'button', { name: 'Learn more…' } ) ) {
			fireEvent.click( link );
		}
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/agent-skills-wordpress-studio/'
		);
	} );

	it( 'offers Retry when the skills fail to load', async () => {
		const connector = createFakeConnector();
		connector.getWordPressSkillsStatusAllSites.mockRejectedValueOnce( new Error( 'Offline' ) );
		renderWithProviders( <SkillsPanel />, { connector } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Retry' } ) );
		expect( await screen.findByText( 'No skills are available.' ) ).toBeVisible();
		expect( connector.getWordPressSkillsStatusAllSites ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'disables every control while a change saves', async () => {
		const connector = createFakeConnector(
			{},
			{
				getWordPressSkillsStatusAllSites: async () => [
					{ id: 'studio-cli', displayName: 'Studio CLI', description: '', installed: true },
					{ id: 'blocks', displayName: 'Blocks', description: '', installed: false },
				],
				installWordPressSkillToAllSites: () => new Promise( () => {} ),
			}
		);
		renderWithProviders( <SkillsPanel onManageSite={ vi.fn() } />, { connector } );
		fireEvent.click( await screen.findByRole( 'switch', { name: 'Blocks' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'switch', { name: 'Studio CLI' } ) ).toHaveAttribute(
				'data-disabled'
			)
		);
		expect( screen.getByRole( 'switch', { name: 'WordPress skills' } ) ).toHaveAttribute(
			'data-disabled'
		);
		expect( screen.getByRole( 'button', { name: 'Manage skills for this site' } ) ).toBeDisabled();
	} );
} );
