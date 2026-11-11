import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearComposerDrafts } from '@/features/composer';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SessionEntry } from '@/data/core';

beforeEach( () => {
	localStorage.clear();
	clearComposerDrafts();
} );

afterEach( () => vi.restoreAllMocks() );

function setup( running = false ) {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', name: 'First', running } ) ],
		sessions: [
			{
				summary: makeSession( { id: 'chat', ownerSiteId: 'one' } ),
				entries: [
					{
						id: 'prompt',
						type: 'custom',
						customType: 'studio.user_prompt',
						data: { text: 'Show me the design system.', source: 'prompt' },
					} as SessionEntry,
					{
						id: 'reply',
						type: 'message',
						message: {
							role: 'assistant',
							content: [ { type: 'text', text: '[Design System](studio:design-system)' } ],
						},
					} as SessionEntry,
				],
			},
		],
	} );
	return renderApp( { connector, path: '/sessions/chat' } );
}

it.each( [ 'browser', 'desktop' ] )(
	'starts the site before opening a chat tool link in %s',
	async ( runtime ) => {
		if ( runtime === 'desktop' )
			vi.spyOn( navigator, 'userAgent', 'get' ).mockReturnValue( 'Electron/38.0.0' );
		const { connector, history } = setup();
		let finish!: () => void;
		const pending = new Promise< void >( ( resolve ) => {
			finish = resolve;
		} );
		const start = connector.startSite.getMockImplementation()!;
		connector.startSite.mockImplementationOnce( async ( id ) => {
			await pending;
			return start( id );
		} );
		const link = await screen.findByRole( 'button', { name: 'Open Design System' } );
		fireEvent.click( link );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		expect( link ).toBeDisabled();
		expect( screen.queryByRole( 'tab', { name: 'Design System' } ) ).not.toBeInTheDocument();
		fireEvent.click( link );
		expect( connector.startSite ).toHaveBeenCalledOnce();
		await act( async () => finish() );
		await waitFor( () =>
			expect( screen.getByRole( 'tab', { name: 'Design System' } ) ).toHaveAttribute(
				'aria-selected',
				'true'
			)
		);
		expect( history.location.pathname ).toBe( '/sessions/chat' );
		expect( screen.getByRole( 'button', { name: 'Stop First' } ) ).toBeEnabled();
		expect( link ).toBeEnabled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	}
);

it( 'reports a failed start and lets the tool link retry without opening a tab', async () => {
	const { connector, history } = setup();
	connector.startSite.mockRejectedValueOnce( new Error( 'Port is unavailable' ) );
	const link = await screen.findByRole( 'button', { name: 'Open Design System' } );
	fireEvent.click( link );
	expect( ( await screen.findAllByText( 'Port is unavailable' ) )[ 0 ] ).toBeVisible();
	expect( screen.queryByRole( 'tab', { name: 'Design System' } ) ).not.toBeInTheDocument();
	expect( history.location.pathname ).toBe( '/sessions/chat' );
	await waitFor( () => expect( link ).toBeEnabled() );
	fireEvent.click( link );
	await screen.findByRole( 'tab', { name: 'Design System' } );
	expect( connector.startSite ).toHaveBeenCalledTimes( 2 );
} );

it( 'opens a tool directly when its site is already running', async () => {
	const { connector } = setup( true );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Open Design System' } ) );
	await screen.findByRole( 'tab', { name: 'Design System' } );
	expect( connector.startSite ).not.toHaveBeenCalled();
} );
