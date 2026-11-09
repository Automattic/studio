import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginCard } from './index';

interface Request {
	id?: number;
	method: string;
	params?: { name?: string; arguments?: Record< string, unknown > };
}
const requests: Request[] = [];
let visible: IntersectionObserverCallback;
let failToken: boolean;
let failLink: boolean;

beforeEach( () => {
	requests.length = 0;
	failToken = false;
	failLink = false;
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			constructor( callback: IntersectionObserverCallback ) {
				visible = callback;
			}
			observe() {}
			disconnect() {}
		}
	);
	vi.spyOn( document, 'visibilityState', 'get' ).mockReturnValue( 'visible' );
	vi.spyOn( window, 'postMessage' ).mockImplementation( ( request: Request ) => {
		requests.push( request );
		if ( request.id === undefined ) return;
		const args = request.params?.arguments;
		const result = args?.token
			? failToken
				? { isError: true, content: [ { type: 'text', text: 'That token did not work.' } ] }
				: { content: [] }
			: {
					_meta: { url: 'https://example.com/authorize', authAttemptId: 'opaque-attempt' },
					content: [],
			  };
		queueMicrotask( () =>
			window.dispatchEvent(
				new MessageEvent( 'message', {
					source: window,
					data: {
						jsonrpc: '2.0',
						id: request.id,
						...( failLink && request.method === 'ui/open-link'
							? { error: { message: 'Link unavailable' } }
							: { result } ),
					},
				} )
			)
		);
	} );
} );

afterEach( () => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
} );

function mount() {
	return render(
		<StrictMode>
			<QueryClientProvider
				client={ new QueryClient( { defaultOptions: { mutations: { retry: false } } } ) }
			>
				<LoginCard />
			</QueryClientProvider>
		</StrictMode>
	);
}

const calls = ( name: string ) =>
	requests
		.filter( ( request ) => request.params?.name === name )
		.map( ( request ) => request.params?.arguments );
const reveal = () =>
	act( () =>
		visible(
			[ { isIntersecting: true } ] as IntersectionObserverEntry[],
			{} as IntersectionObserver
		)
	);

it( 'records visible presentations once, carries the journey into the explicit login, and keeps attempts out of links', async () => {
	const view = mount();
	expect( calls( 'wpcom_login_event' ) ).toEqual( [] );
	reveal();
	reveal();
	await waitFor( () => expect( calls( 'wpcom_login_event' ) ).toHaveLength( 1 ) );
	const journeyId = calls( 'wpcom_login_event' )[ 0 ]?.journeyId;
	expect( journeyId ).toMatch( /^[0-9a-f-]{36}$/ );
	fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
	await screen.findByLabelText( 'WordPress.com token' );
	expect( calls( 'wpcom_login' )[ 0 ] ).toEqual( { journeyId } );
	expect( requests.find( ( request ) => request.method === 'ui/open-link' )?.params ).toEqual( {
		url: 'https://example.com/authorize',
	} );
	fireEvent.change( screen.getByLabelText( 'WordPress.com token' ), {
		target: { value: 'private-token' },
	} );
	fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );
	await waitFor( () => expect( calls( 'wpcom_login' ) ).toHaveLength( 2 ) );
	expect( calls( 'wpcom_login' )[ 1 ] ).toEqual( {
		token: 'private-token',
		attemptId: 'opaque-attempt',
		journeyId,
		retry: false,
	} );
	view.unmount();
	expect( calls( 'wpcom_login_event' ) ).toHaveLength( 1 );
} );

it( 'does not count hidden prompts, and counts a newly opened card with a fresh journey', async () => {
	const visibility = vi.spyOn( document, 'visibilityState', 'get' ).mockReturnValue( 'hidden' );
	const first = mount();
	reveal();
	expect( calls( 'wpcom_login_event' ) ).toEqual( [] );
	visibility.mockReturnValue( 'visible' );
	act( () => {
		document.dispatchEvent( new Event( 'visibilitychange' ) );
	} );
	await waitFor( () => expect( calls( 'wpcom_login_event' ) ).toHaveLength( 1 ) );
	first.unmount();
	mount();
	reveal();
	await waitFor( () => expect( calls( 'wpcom_login_event' ) ).toHaveLength( 2 ) );
	expect( calls( 'wpcom_login_event' )[ 1 ]?.journeyId ).not.toBe(
		calls( 'wpcom_login_event' )[ 0 ]?.journeyId
	);
} );

it( 'marks only explicit token retries and preserves the existing error and retry controls', async () => {
	mount();
	fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
	const input = await screen.findByLabelText( 'WordPress.com token' );
	failToken = true;
	fireEvent.change( input, { target: { value: 'bad-token' } } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );
	await screen.findByText( 'That token did not work.' );
	failToken = false;
	fireEvent.change( input, { target: { value: 'good-token' } } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );
	await waitFor( () => expect( calls( 'wpcom_login' ) ).toHaveLength( 3 ) );
	expect( calls( 'wpcom_login' )[ 1 ]?.retry ).toBe( false );
	expect( calls( 'wpcom_login' )[ 2 ]?.retry ).toBe( true );
	expect( calls( 'wpcom_login' )[ 2 ]?.journeyId ).toBe( calls( 'wpcom_login' )[ 1 ]?.journeyId );
} );

it( 'records a handoff failure only when both the host and browser fallback throw', async () => {
	failLink = true;
	vi.spyOn( window, 'open' ).mockImplementation( () => {
		throw new Error( 'Browser unavailable' );
	} );
	mount();
	fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
	await screen.findByText( 'Browser unavailable' );
	await waitFor( () =>
		expect( calls( 'wpcom_login_event' ) ).toEqual( [
			{ event: 'launch_failed', attemptId: 'opaque-attempt' },
		] )
	);
} );

it( 'does not classify a fallback with no observable result as cancellation or launch failure', async () => {
	failLink = true;
	vi.spyOn( window, 'open' ).mockReturnValue( null );
	const view = mount();
	fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
	await screen.findByLabelText( 'WordPress.com token' );
	view.unmount();
	expect( calls( 'wpcom_login_event' ) ).toEqual( [] );
} );
