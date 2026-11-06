import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	let reject!: ( error: Error ) => void;
	const promise = new Promise< T >( ( onResolve, onReject ) => {
		resolve = onResolve;
		reject = onReject;
	} );
	return { promise, resolve, reject };
}

function setup() {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', path: '/sites/one' } ) ],
		user: TEST_USER,
	} );
	return renderApp( { connector, path: '/sites/one/new' } );
}

const sidebar = () => within( screen.getByRole( 'group', { name: 'Sites' } ) );
const composer = () => screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );

beforeEach( () => localStorage.clear() );

describe( 'First message in the sidebar', () => {
	it( 'shows the submitted message during creation and startup, then replaces it with one saved chat', async () => {
		const { connector, history, queryClient } = setup();
		const creation = deferred< void >();
		const startup = deferred< { runId: string } >();
		const createSession = connector.createSession.getMockImplementation()!;
		connector.createSession.mockImplementationOnce( async ( siteId ) => {
			await creation.promise;
			return createSession( siteId );
		} );
		connector.continueSession.mockImplementationOnce( () => startup.promise );
		fireEvent.change( await composer(), { target: { value: 'Build a gallery' } } );
		expect(
			sidebar().queryByRole( 'button', { name: 'Build a gallery' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( await sidebar().findByRole( 'button', { name: 'Build a gallery' } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect( connector.continueSession ).not.toHaveBeenCalled();
		await act( async () => creation.resolve() );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'sessions' ] } ) );
		expect( sidebar().getByRole( 'button', { name: 'Build a gallery' } ) ).toBeVisible();
		connector.state.sessions[ 0 ].summary.firstPrompt = 'Build a gallery';
		await act( async () => startup.resolve( { runId: 'gallery-run' } ) );
		await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\// ) );
		expect( sidebar().getAllByRole( 'button', { name: /Build a gallery/ } ) ).toHaveLength( 1 );
		expect( sidebar().getByRole( 'button', { name: /Build a gallery/ } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
	} );

	it.each( [ 'createSession', 'setSessionProvider', 'continueSession' ] as const )(
		'removes the temporary row and restores the message when %s fails',
		async ( operation ) => {
			const { connector, history } = setup();
			const failure = deferred< never >();
			connector[ operation ].mockImplementationOnce( () => failure.promise );
			fireEvent.change( await composer(), { target: { value: 'Keep my message' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
			expect( await sidebar().findByRole( 'button', { name: 'Keep my message' } ) ).toBeVisible();
			await waitFor( () => expect( connector[ operation ] ).toHaveBeenCalledOnce() );
			await act( async () => failure.reject( new Error( 'Send failed' ) ) );
			await waitFor( () => {
				expect(
					sidebar().queryByRole( 'button', { name: 'Keep my message' } )
				).not.toBeInTheDocument();
			} );
			expect( await composer() ).toHaveValue( 'Keep my message' );
			expect( history.location.pathname ).toBe( '/sites/one/new' );
		}
	);
} );
