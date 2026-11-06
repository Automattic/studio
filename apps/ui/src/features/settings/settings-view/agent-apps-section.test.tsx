import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AgentAppsSection } from './agent-apps-section';
import type { AgentApp, AgentAppId } from '@/data/core';

async function setup( {
	connected = [],
	updates = {},
}: {
	connected?: AgentAppId[];
	updates?: Partial< Record< AgentAppId, AgentApp[ 'updateStatus' ] > >;
} = {} ) {
	const connector = createFakeConnector();
	const plugins = new Set( connected );
	connector.getAgentApps.mockImplementation( async () => [
		{
			id: 'claude-code',
			installed: true,
			connected: plugins.has( 'claude-code' ),
			updateStatus: updates[ 'claude-code' ],
		},
		{ id: 'codex', installed: false, connected: false },
		{
			id: 'cursor',
			installed: true,
			connected: plugins.has( 'cursor' ),
			updateStatus: updates.cursor,
		},
		{
			id: 'grok-build',
			installed: true,
			connected: plugins.has( 'grok-build' ),
			updateStatus: updates[ 'grok-build' ],
		},
	] );
	connector.connectAgentApp.mockImplementation( async ( id ) => {
		plugins.add( id );
		delete updates[ id ];
	} );
	renderWithProviders( <AgentAppsSection />, { connector } );
	const row = async ( name: string ) => within( await screen.findByRole( 'group', { name } ) );
	return { connector, plugins, row };
}

describe( 'Agent apps setting', () => {
	it( 'installs the plugin in an app and shows it connected', async () => {
		const { connector, row } = await setup();
		const grok = await row( 'Grok Build' );
		const description = grok.getByText(
			'Installs the WordPress Studio plugin. Start a new Grok Build session to use it.'
		);
		fireEvent.click( grok.getByRole( 'button', { name: 'Connect' } ) );
		await waitFor( () => expect( connector.connectAgentApp ).toHaveBeenCalledWith( 'grok-build' ) );
		expect( await grok.findByText( 'Connected' ) ).toBeVisible();
		expect( grok.queryByRole( 'button', { name: 'Connected' } ) ).not.toBeInTheDocument();
		expect( description ).toBeVisible();
		expect( grok.getByRole( 'button', { name: /^Learn more/ } ) ).toBeEnabled();
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
		expect( cursor.getByRole( 'button', { name: /^Learn more/ } ) ).toBeEnabled();
		finish();
		expect( await cursor.findByText( 'Connected' ) ).toBeVisible();
	} );

	it( 'shows an app that already has the plugin as connected', async () => {
		const { row } = await setup( { connected: [ 'claude-code', 'cursor' ] } );
		for ( const name of [ 'Claude Code', 'Cursor' ] ) {
			const app = await row( name );
			expect( app.getByText( 'Connected' ) ).toBeVisible();
			expect( app.queryByRole( 'button', { name: 'Connected' } ) ).not.toBeInTheDocument();
			expect( app.queryByRole( 'button', { name: 'Update' } ) ).not.toBeInTheDocument();
			expect( app.getByRole( 'button', { name: /^Learn more/ } ) ).toBeEnabled();
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
		expect( claude.getByRole( 'alert' ) ).toHaveTextContent( 'network down' );
		expect( claude.getByRole( 'button', { name: /^Learn more/ } ) ).toBeEnabled();
		expect(
			claude.getByText(
				'Installs the WordPress Studio plugin. Start a new Claude Code session to use it.'
			)
		).toBeVisible();
		fireEvent.click( claude.getByRole( 'button', { name: 'Retry' } ) );
		expect( await claude.findByText( 'Connected' ) ).toBeVisible();
		expect( claude.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );

	it( 'disables an app that isn’t installed', async () => {
		const { connector, row } = await setup();
		const chatgpt = await row( 'ChatGPT' );
		expect(
			chatgpt.getByText(
				'Installs the WordPress Studio plugin in Codex. Restart the ChatGPT app to use it.'
			)
		).toBeVisible();
		const button = chatgpt.getByRole( 'button', { name: 'Not installed' } );
		expect( button ).toBeDisabled();
		fireEvent.click( button );
		expect( connector.connectAgentApp ).not.toHaveBeenCalled();
	} );

	it( 'keeps the Connected badge while an available update runs', async () => {
		const { connector, row } = await setup( {
			connected: [ 'claude-code' ],
			updates: { 'claude-code': 'available' },
		} );
		let finish!: () => void;
		connector.connectAgentApp.mockImplementationOnce(
			() =>
				new Promise< void >( ( resolve ) => {
					finish = resolve;
				} )
		);
		const claude = await row( 'Claude Code' );
		expect( claude.getByText( 'Connected' ) ).toBeVisible();
		fireEvent.click( claude.getByRole( 'button', { name: 'Update' } ) );
		expect( await claude.findByRole( 'button', { name: 'Updating…' } ) ).toBeDisabled();
		expect( claude.getByText( 'Connected' ) ).toBeVisible();
		expect( claude.getByRole( 'button', { name: /^Learn more/ } ) ).toBeEnabled();
		finish();
		await waitFor( () =>
			expect( connector.connectAgentApp ).toHaveBeenCalledWith( 'claude-code' )
		);
	} );

	it( 'offers Retry update after a failed update and removes it when the retry succeeds', async () => {
		const { connector, row } = await setup( {
			connected: [ 'claude-code' ],
			updates: { 'claude-code': 'available' },
		} );
		connector.connectAgentApp.mockRejectedValueOnce( new Error( 'Update failed: network down' ) );
		const claude = await row( 'Claude Code' );
		fireEvent.click( claude.getByRole( 'button', { name: 'Update' } ) );
		expect( await claude.findByRole( 'alert' ) ).toHaveTextContent( 'network down' );
		expect( claude.getByText( 'Connected' ) ).toBeVisible();
		fireEvent.click( claude.getByRole( 'button', { name: 'Retry update' } ) );
		await waitFor( () =>
			expect( claude.queryByRole( 'button', { name: /update/i } ) ).not.toBeInTheDocument()
		);
		expect( claude.getByText( 'Connected' ) ).toBeVisible();
		expect( claude.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );

	it( 'offers Retry update when an automatic update needs to reinstall the plugin', async () => {
		const { connector, row } = await setup( { updates: { 'grok-build': 'failed' } } );
		const grok = await row( 'Grok Build' );
		expect( grok.queryByText( 'Connected' ) ).not.toBeInTheDocument();
		fireEvent.click( grok.getByRole( 'button', { name: 'Retry update' } ) );
		expect( await grok.findByText( 'Connected' ) ).toBeVisible();
		expect( connector.connectAgentApp ).toHaveBeenCalledWith( 'grok-build' );
	} );

	it( 'disables the action during an automatic update', async () => {
		const { row } = await setup( {
			connected: [ 'cursor' ],
			updates: { cursor: 'updating' },
		} );
		const cursor = await row( 'Cursor' );
		expect( cursor.getByRole( 'button', { name: 'Updating…' } ) ).toBeDisabled();
		expect( cursor.getByText( 'Connected' ) ).toBeVisible();
		expect( cursor.getByRole( 'button', { name: /^Learn more/ } ) ).toBeEnabled();
	} );

	it.each( [
		[ 'Claude Code', 'https://github.com/Automattic/studio-plugins#install-in-claude-code' ],
		[ 'ChatGPT', 'https://github.com/Automattic/studio-plugins#install-in-codex' ],
		[ 'Cursor', 'https://cursor.com/docs/plugins' ],
		[ 'Grok Build', 'https://docs.x.ai/build/features/skills-plugins-marketplaces' ],
	] )(
		'opens the plugin setup guide for %s regardless of installation state',
		async ( name, url ) => {
			const { connector, row } = await setup( { connected: [ 'claude-code', 'cursor' ] } );
			const app = await row( name );
			fireEvent.click( app.getByRole( 'button', { name: /^Learn more/ } ) );
			expect( connector.openExternalUrl ).toHaveBeenCalledWith( url );
			expect( connector.connectAgentApp ).not.toHaveBeenCalled();
		}
	);
} );
