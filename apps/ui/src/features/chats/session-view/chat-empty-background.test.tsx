import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

vi.setConfig( { testTimeout: 30_000 } );

beforeEach( () =>
	document.documentElement.style.setProperty( '--motion-duration-layout', '300ms' )
);
afterEach( () => document.documentElement.style.removeProperty( '--motion-duration-layout' ) );

const elapse = ( ms: number ) => act( () => new Promise( ( done ) => setTimeout( done, ms ) ) );

const background = () => document.querySelector( '[class*="emptyState"]' );

async function openEmptyChat() {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 's' } ) ],
		sessions: [ { summary: makeSession( { id: 'chat', ownerSiteId: 's' } ), entries: [] } ],
	} );
	const { queryClient } = renderApp( { connector, path: '/sessions/chat' } );
	await waitFor( () => expect( connector.getStudioAssistantQuota ).toHaveBeenCalled() );
	await waitFor( () => expect( queryClient.isFetching() ).toBe( 0 ) );
	const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
	await waitFor( () => expect( background() ).toBeInTheDocument() );
	return { connector, input, empty: background()! };
}

describe( 'empty chat background exit', () => {
	it( 'retains the same background while it fades, then removes it', async () => {
		const { input, empty } = await openEmptyChat();
		fireEvent.change( input, { target: { value: 'Build a homepage' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		await waitFor( () => expect( empty ).toHaveAttribute( 'data-hidden' ) );
		await elapse( 150 );
		expect( background() ).toBe( empty );
		await waitFor( () => expect( background() ).toBeNull() );
	} );

	it( 'cancels removal when an empty chat returns during the fade', async () => {
		const { connector, input, empty } = await openEmptyChat();
		let fail!: ( error: Error ) => void;
		connector.continueSession.mockReturnValue(
			new Promise( ( _resolve, reject ) => {
				fail = reject;
			} )
		);
		fireEvent.change( input, { target: { value: 'Build a homepage' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		await waitFor( () => expect( empty ).toHaveAttribute( 'data-hidden' ) );
		await elapse( 150 );
		fail( new Error( 'Disconnected' ) );
		await waitFor( () => expect( empty ).not.toHaveAttribute( 'data-hidden' ) );
		await elapse( 400 );
		expect( background() ).toBe( empty );
	} );
} );
