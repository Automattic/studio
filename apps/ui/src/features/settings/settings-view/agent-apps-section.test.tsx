import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AgentAppsSection } from './agent-apps-section';
import type { AgentAppId } from '@/data/core';

async function setup( { connected = [] }: { connected?: AgentAppId[] } = {} ) {
	const connector = createFakeConnector();
	const plugins = new Set( connected );
	connector.getAgentApps.mockImplementation( async () => [
		{ id: 'claude-code', installed: true, connected: plugins.has( 'claude-code' ) },
		{ id: 'codex', installed: false, connected: false },
		{ id: 'cursor', installed: true, connected: plugins.has( 'cursor' ) },
		{ id: 'grok-build', installed: true, connected: plugins.has( 'grok-build' ) },
	] );
	connector.connectAgentApp.mockImplementation( async ( id ) => {
		plugins.add( id );
	} );
	renderWithProviders( <AgentAppsSection />, { connector } );
	const row = async ( name: string ) => within( await screen.findByRole( 'group', { name } ) );
	return { connector, plugins, row };
}

describe( 'Agent apps setting', () => {
	it( 'installs the plugin in an app and shows it connected', async () => {
		const { connector, row } = await setup();
		const grok = await row( 'Grok Build' );
		fireEvent.click( grok.getByRole( 'button', { name: 'Connect' } ) );
		await waitFor( () => expect( connector.connectAgentApp ).toHaveBeenCalledWith( 'grok-build' ) );
		expect( await grok.findByText( 'Connected' ) ).toBeVisible();
		expect( grok.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );

	it( 'disables the button while it connects', async () => {
		const { connector, plugins, row } = await setup();
		let finish!: () => void;
		connector.connectAgentApp.mockImplementationOnce(
			( id ) =>
				new Promise< void >( ( resolve ) => {
					finish = () => {
						plugins.add( id );
						resolve();
					};
				} )
		);
		const cursor = await row( 'Cursor' );
		fireEvent.click( cursor.getByRole( 'button', { name: 'Connect' } ) );
		expect( await cursor.findByRole( 'button', { name: 'Connecting…' } ) ).toBeDisabled();
		finish();
		expect( await cursor.findByText( 'Connected' ) ).toBeVisible();
	} );

	it( 'shows an app that already has the plugin as connected', async () => {
		const { row } = await setup( { connected: [ 'claude-code', 'cursor' ] } );
		for ( const name of [ 'Claude Code', 'Cursor' ] ) {
			const app = await row( name );
			expect( app.getByText( 'Connected' ) ).toBeVisible();
			expect( app.queryByRole( 'button' ) ).not.toBeInTheDocument();
		}
	} );

	it( 'shows the app’s error', async () => {
		const { connector, row } = await setup();
		connector.connectAgentApp.mockRejectedValueOnce(
			new Error( 'Claude Code couldn’t install the WordPress Studio plugin: network down' )
		);
		const claude = await row( 'Claude Code' );
		fireEvent.click( claude.getByRole( 'button', { name: 'Connect' } ) );
		expect(
			await claude.findByText(
				'Claude Code couldn’t install the WordPress Studio plugin: network down'
			)
		).toBeVisible();
		expect( claude.queryByText( 'Connected' ) ).not.toBeInTheDocument();
	} );

	it( 'disables an app that isn’t installed', async () => {
		const { connector, row } = await setup();
		const chatgpt = await row( 'ChatGPT' );
		expect( chatgpt.getByText( 'Not found on this computer.' ) ).toBeVisible();
		const button = chatgpt.getByRole( 'button', { name: 'Connect' } );
		expect( button ).toBeDisabled();
		fireEvent.click( button );
		expect( connector.connectAgentApp ).not.toHaveBeenCalled();
	} );
} );
