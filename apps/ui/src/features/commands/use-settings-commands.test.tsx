import { act, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests } from '@/data/app-messages';
import { useSettingCommands } from '@/features/commands/use-setting-commands';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { PaletteCommand } from '@/features/commands/studio-commands';

beforeEach( resetAppMessagesForTests );

function setup( collapse: boolean ) {
	const connector = createFakeConnector( {
		preferences: { autoCollapseSites: collapse },
	} );
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
	for ( const id of [
		'settings-general-open-chat-on-site-start',
		'settings-appearance-reset-appearance',
		'settings-general-documentation',
	] ) {
		expect( find( id ).group ).toBe( 'commands' );
	}
	expect( find( 'settings-general-studio-cli' ).group ).toBe( 'settings' );
	expect( find( 'settings-instructions' ).group ).toBe( 'settings' );
	expect( find( 'settings-general-studio-cli' ).label ).toBe( 'WordPress Studio CLI for terminal' );
	expect( find( 'settings-instructions' ).label ).toBe( 'Instructions' );
	act( () => find( 'settings-appearance-reset-appearance' ).run() );
	await waitFor( () =>
		expect( connector.setUserPreferences ).toHaveBeenCalledWith(
			{ colorScheme: 'system', accentColor: '#3858e9', tintIntensity: 0, contrast: 0 },
			undefined
		)
	);
	await waitFor( () => expect( getNoticeHistory().at( 0 )?.title ).toBe( 'Appearance reset.' ) );
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
	await waitFor( () => expect( getNoticeHistory().at( 0 )?.title ).toBe( 'Interface reset.' ) );
} );

it.each( [ false, true ] )(
	'reports a preference change only after persistence settles (fails: %s)',
	async ( fails ) => {
		const { connector, command } = setup( false );
		await waitFor( () => expect( command() ).toBeDefined() );
		let settle!: () => void;
		connector.setUserPreferences.mockImplementation(
			() =>
				new Promise< void >( ( resolve, reject ) => {
					settle = () => ( fails ? reject( new Error( 'Save failed' ) ) : resolve() );
				} )
		);
		act( () => command()!.run() );
		await waitFor( () => expect( connector.setUserPreferences ).toHaveBeenCalledOnce() );
		expect( getNoticeHistory() ).toHaveLength( 0 );
		await act( async () => settle() );
		await waitFor( () => expect( getNoticeHistory() ).toHaveLength( 1 ) );
		expect( getNoticeHistory()[ 0 ] ).toMatchObject(
			fails
				? {
						intent: 'error',
						title: 'Could not update settings. Please try again.',
				  }
				: { intent: 'success', title: 'Automatic sidebar collapsing enabled.' }
		);
	}
);
