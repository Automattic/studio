import { act, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSettingCommands } from '@/features/commands/use-setting-commands';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { PaletteCommand } from '@/features/commands/studio-commands';

function setup( collapse: boolean, skillInstalled?: boolean ) {
	const skills = [
		{
			id: 'wp-test',
			displayName: 'Test skill',
			description: 'Test',
			installed: skillInstalled ?? false,
		},
	];
	const connector = createFakeConnector( {
		preferences: { autoCollapseSites: collapse },
	} );
	if ( skillInstalled !== undefined ) {
		connector.getWordPressSkillsStatusAllSites.mockImplementation( async () =>
			skills.map( ( skill ) => ( { ...skill } ) )
		);
		connector.installWordPressSkillToAllSites.mockImplementation( async () => {
			skills[ 0 ].installed = true;
		} );
		connector.removeWordPressSkillFromAllSites.mockImplementation( async () => {
			skills[ 0 ].installed = false;
		} );
	}
	const result: { current: PaletteCommand[] } = { current: [] };
	function Probe() {
		result.current = useSettingCommands( 'studio' );
		return null;
	}
	renderWithProviders( <Probe />, { connector } );
	const command = () =>
		result.current.find( ( entry ) => entry.id === 'settings-general-collapse-sidebar-groups' );
	return { connector, command, result };
}

it.each( [ false, true ] )(
	'flips and refreshes the persisted sidebar preference from %s',
	async ( checked ) => {
		const { connector, command } = setup( checked );
		const label = ( on: boolean ) =>
			on ? 'Disable automatic sidebar collapsing' : 'Enable automatic sidebar collapsing';
		await waitFor( () => expect( command()?.label ).toBe( label( checked ) ) );
		act( () => command()!.run() );
		await waitFor( () => expect( command()?.label ).toBe( label( ! checked ) ) );
		expect( connector.setUserPreferences ).toHaveBeenCalledWith(
			{ autoCollapseSites: ! checked },
			undefined
		);
	}
);

it( 'uses direct actions once while keeping CLI and instructions as settings links', async () => {
	const { connector, result } = setup( false );
	await waitFor( () =>
		expect(
			result.current.find( ( entry ) => entry.id === 'settings-general-open-chat-on-site-start' )
				?.label
		).toMatch( /^(Enable|Disable) chat opening/ )
	);
	const find = ( id: string ) => result.current.find( ( entry ) => entry.id === id )!;
	expect( result.current.filter( ( entry ) => entry.label === 'Reset appearance' ) ).toHaveLength(
		1
	);
	expect( find( 'settings-general-studio-cli' ).label ).toBe( 'Studio CLI for terminal' );
	expect( find( 'settings-instructions-agent-instructions' ).label ).toBe( 'Agent instructions' );
	act( () => find( 'settings-appearance-reset-appearance' ).run() );
	await waitFor( () =>
		expect( connector.setUserPreferences ).toHaveBeenCalledWith(
			{ colorScheme: 'system', accentColor: '#3858e9', tintIntensity: 0, contrast: 0 },
			undefined
		)
	);
	act( () => find( 'settings-general-documentation' ).run() );
	expect( connector.openExternalUrl ).toHaveBeenCalled();
} );

it( 'resets interface preferences through the existing persistence action', async () => {
	const { connector, result } = setup( false );
	await waitFor( () => expect( connector.getUserPreferences ).toHaveBeenCalled() );
	act( () =>
		result.current.find( ( entry ) => entry.id === 'settings-general-reset-interface' )!.run()
	);
	await waitFor( () =>
		expect( connector.setUserPreferences ).toHaveBeenCalledWith(
			expect.objectContaining( { colorScheme: 'system', autoCollapseSites: true } ),
			undefined
		)
	);
} );

it.each( [ false, true ] )( 'toggles WordPress skills directly from %s', async ( installed ) => {
	const { connector, result } = setup( false, installed );
	const command = () =>
		result.current.find( ( entry ) => entry.id === 'settings-skills-wordpress-skills' )!;
	await waitFor( () =>
		expect( command()?.label ).toBe(
			installed ? 'Disable WordPress skills' : 'Enable WordPress skills'
		)
	);
	act( () => command().run() );
	await waitFor( () =>
		expect( command().label ).toBe(
			installed ? 'Enable WordPress skills' : 'Disable WordPress skills'
		)
	);
	expect(
		installed
			? connector.removeWordPressSkillFromAllSites
			: connector.installWordPressSkillToAllSites
	).toHaveBeenCalledWith( 'wp-test' );
} );
