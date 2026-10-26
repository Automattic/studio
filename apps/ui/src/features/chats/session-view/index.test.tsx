import { STUDIO_ASSISTANT_QUOTA_OFFLINE } from '@studio/common/lib/studio-assistant-quota';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app';
import { ASSISTANT_QUOTA_QUERY_KEY } from '@/data/queries/use-assistant-quota';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { pendingPromptSlot } from '@/features/composer';
import { createFakeConnector, makeSession, makeSite, TEST_USER } from '@/test/fake-connector';
import { createTestQueryClient, renderApp } from '@/test/render';
import { isScrolledAwayFromLatest, useAnchoredScroll } from './use-anchored-scroll';
import type { SessionEntry } from '@/data/core';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

const SITE = makeSite( { id: 'site-1', name: 'Demo' } );
const PATH = '/sessions/chat';
const COMPOSER = { name: 'Message WordPress Studio' };

function quota( overrides: Partial< StudioAssistantQuota > = {} ) {
	return {
		costUsage: 0,
		costCap: 500000,
		emailVerified: true,
		hasPaymentMethod: true,
		studioCodeAiHasAccess: true,
		studioCodeAiAccess: 'granted',
		allowanceRemaining: 100,
		purchasedRemaining: 0,
		...overrides,
	} as StudioAssistantQuota;
}

const prompt = ( text: string ) =>
	( {
		type: 'custom',
		id: `prompt-${ text }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		customType: 'studio.user_prompt',
		data: { text, source: 'prompt' },
	} ) as SessionEntry;

function chatConnector( {
	entries = [],
	site = SITE,
	user = TEST_USER,
}: { entries?: SessionEntry[]; site?: typeof SITE; user?: typeof TEST_USER } = {} ) {
	const connector = createFakeConnector( {
		sites: [ site ],
		user,
		sessions: [ { summary: makeSession( { id: 'chat', ownerSiteId: site.id } ), entries } ],
	} );
	connector.getStudioAssistantQuota.mockResolvedValue( quota() );
	return connector;
}

const composer = () =>
	waitFor( () => expect( screen.getByRole( 'combobox', COMPOSER ) ).toBeVisible() );
const scroller = () => document.querySelector( '[data-chat-transcript]' )!.parentElement!;
const jumpButton = () => screen.getByRole( 'button', { name: 'Jump to latest' } );
const sleep = ( ms: number ) =>
	act( () => new Promise( ( resolve ) => setTimeout( resolve, ms ) ) );

function setScrollMetrics(
	node: HTMLElement,
	metrics: Partial< { scrollTop: number; scrollHeight: number; clientHeight: number } >
) {
	for ( const [ key, value ] of Object.entries( metrics ) ) {
		Object.defineProperty( node, key, { value, writable: true, configurable: true } );
	}
}

afterEach( () => {
	const pending = pendingPromptSlot.getSnapshot();
	if ( pending ) pendingPromptSlot.clear( pending );
	vi.restoreAllMocks();
} );

describe( 'SessionView loading', () => {
	it( 'redirects to the root instead of flashing the error when the chat is gone', async () => {
		const connector = chatConnector();
		connector.getSession.mockRejectedValue( new Error( 'Code session not found: chat' ) );
		const { history } = renderApp( { connector, path: PATH } );

		await waitFor( () => expect( history.location.pathname ).not.toBe( PATH ) );
		expect( screen.queryByText( 'This chat could not load.' ) ).not.toBeInTheDocument();
	} );

	it( 'offers a retry instead of leaving when the chat fails to load', async () => {
		const connector = chatConnector();
		connector.getSession.mockRejectedValueOnce( new Error( 'EACCES' ) );
		const { history } = renderApp( { connector, path: PATH } );

		expect( await screen.findByText( 'This chat could not load.' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );

		await composer();
		expect( history.location.pathname ).toBe( PATH );
	} );

	it( 'stays on a chat that is still loading', async () => {
		const connector = chatConnector();
		connector.getSession.mockReturnValue( new Promise( () => {} ) );
		const { history } = renderApp( { connector, path: PATH } );

		await waitFor( () => expect( connector.getSession ).toHaveBeenCalled() );
		await sleep( 50 );
		expect( history.location.pathname ).toBe( PATH );
	} );
} );

describe( 'SessionView handed-over prompt', () => {
	const handover = {
		sessionId: 'chat',
		prompt: 'A bakery site',
		attachments: { images: [], files: [] },
	};

	it( 'sends the prompt handed over for this chat exactly once when the chat is ready', async () => {
		pendingPromptSlot.set( handover );
		const connector = chatConnector();
		render(
			<StrictMode>
				<App
					connector={ connector }
					queryClient={ createTestQueryClient() }
					history={ createMemoryHistory( { initialEntries: [ PATH ] } ) }
				/>
			</StrictMode>
		);

		await waitFor( () =>
			expect( connector.continueSession ).toHaveBeenCalledWith(
				'chat',
				'A bakery site',
				expect.anything()
			)
		);
		await sleep( 50 );
		expect( connector.continueSession ).toHaveBeenCalledOnce();
		expect( pendingPromptSlot.getSnapshot() ).toBeNull();
	} );

	it( 'holds the handed-over prompt while the chat is gated', async () => {
		pendingPromptSlot.set( handover );
		const connector = chatConnector();
		connector.getStudioAssistantQuota.mockResolvedValue( quota( { hasPaymentMethod: false } ) );
		renderApp( { connector, path: PATH } );

		await waitFor( () => expect( screen.getByRole( 'button', { name: 'Set up' } ) ).toBeVisible() );
		expect( connector.continueSession ).not.toHaveBeenCalled();
		expect( pendingPromptSlot.getSnapshot() ).toBe( handover );
	} );
} );

describe( 'SessionView entitlement', () => {
	it.each( [
		{ case: 'a free account', email: TEST_USER.email, purchasedRemaining: 0, model: 'Fast' },
		{
			case: 'an Automattician',
			email: 'someone@automattic.com',
			purchasedRemaining: 0,
			model: 'Balanced',
		},
		{
			case: 'purchased credits',
			email: TEST_USER.email,
			purchasedRemaining: 1000,
			model: 'Balanced',
		},
	] )( 'starts a chat for $case on $model', async ( { email, purchasedRemaining, model } ) => {
		const connector = chatConnector( { user: { ...TEST_USER, email } } );
		connector.getStudioAssistantQuota.mockResolvedValue( quota( { purchasedRemaining } ) );
		renderApp( { connector, path: PATH } );

		await composer();
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Model' } ) ).toHaveTextContent( model )
		);
	} );

	it( 'reads an unreachable WordPress.com as offline, settles on the composer and retries', async () => {
		const connector = chatConnector();
		connector.getStudioAssistantQuota.mockRejectedValue(
			new Error( STUDIO_ASSISTANT_QUOTA_OFFLINE )
		);
		renderApp( { connector, path: PATH } );

		const alert = await screen.findByRole( 'alert' );
		expect( alert ).toHaveTextContent( 'You are offline. Reconnect to send a message.' );
		await composer();
		await sleep( 50 );
		expect( connector.getStudioAssistantQuota ).toHaveBeenCalledOnce();

		fireEvent.click( within( alert ).getByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () => expect( connector.getStudioAssistantQuota ).toHaveBeenCalledTimes( 2 ) );
	} );

	it.each( [
		{
			error: STUDIO_ASSISTANT_QUOTA_OFFLINE,
			notice: 'You are offline. Reconnect to send a message.',
		},
		{ error: 'Unauthorized', notice: 'AI usage is currently unavailable.' },
	] )(
		'keeps the composer and its notice while a failed quota request ($error) is retried',
		async ( { error, notice } ) => {
			const connector = chatConnector();
			connector.getStudioAssistantQuota.mockRejectedValue( new Error( error ) );
			const { queryClient } = renderApp( { connector, path: PATH } );
			expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( notice );

			connector.getStudioAssistantQuota.mockReturnValue( new Promise( () => {} ) );
			void queryClient.refetchQueries( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
			await sleep( 50 );

			expect( screen.getByRole( 'combobox', COMPOSER ) ).toBeInTheDocument();
			expect( screen.getByRole( 'alert' ) ).toHaveTextContent( notice );
		}
	);
} );

describe( 'SessionView scrolling', () => {
	it( 'shows Jump to latest only while scrolled away and scrolls down on click', async () => {
		renderApp( { connector: chatConnector(), path: PATH } );
		await composer();
		const node = scroller();
		expect( jumpButton() ).not.toHaveAttribute( 'data-visible' );

		setScrollMetrics( node, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 } );
		fireEvent.scroll( node );
		await waitFor( () => expect( jumpButton() ).toHaveAttribute( 'data-visible' ) );

		node.scrollTo = vi.fn();
		fireEvent.click( jumpButton() );
		expect( node.scrollTo ).toHaveBeenCalledWith( { top: 1000, behavior: 'smooth' } );
		expect( jumpButton() ).not.toHaveAttribute( 'data-visible' );

		setScrollMetrics( node, { scrollTop: 300 } );
		fireEvent.scroll( node );
		expect( jumpButton() ).not.toHaveAttribute( 'data-visible' );
	} );

	it( 'wires the scroller when the chat loads before the entitlement check resolves', async () => {
		vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockReturnValue( 1000 );
		vi.spyOn( HTMLElement.prototype, 'clientHeight', 'get' ).mockReturnValue( 400 );
		let resolveQuota!: ( value: StudioAssistantQuota ) => void;
		const connector = chatConnector();
		connector.getStudioAssistantQuota.mockReturnValue(
			new Promise( ( resolve ) => {
				resolveQuota = resolve;
			} )
		);
		const { queryClient } = renderApp( { connector, path: PATH } );
		await waitFor( () =>
			expect( queryClient.getQueryData( [ ...SESSIONS_QUERY_KEY, 'chat' ] ) ).toBeDefined()
		);
		expect( screen.queryByRole( 'combobox', COMPOSER ) ).not.toBeInTheDocument();

		await act( async () => resolveQuota( quota() ) );
		await composer();
		const node = scroller();
		expect( node.scrollTop ).toBe( 1000 );

		node.scrollTop = 100;
		fireEvent.scroll( node );
		await waitFor( () => expect( jumpButton() ).toHaveAttribute( 'data-visible' ) );
	} );
} );

describe( 'SessionView stopped site', () => {
	it( 'offers a stopped site its saved preview until the first prompt is in', async () => {
		const connector = chatConnector();
		connector.getSiteThumbnail.mockResolvedValue( 'data:image/png;base64,preview' );
		const { queryClient } = renderApp( { connector, path: PATH } );
		await composer();

		expect(
			await within( scroller() ).findByRole( 'img', { name: 'Saved site preview' } )
		).toBeInTheDocument();

		connector.state.sessions = [
			{ ...connector.state.sessions[ 0 ], entries: [ prompt( 'Hello' ) ] },
		];
		await act( () => queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } ) );

		await waitFor( () =>
			expect(
				within( scroller() ).queryByRole( 'img', { name: 'Saved site preview' } )
			).not.toBeInTheDocument()
		);
	} );
} );

// The transcript scrolls like a log anchored on the user's prompts, laid out
// here at the `top` each one reports.
describe( 'useAnchoredScroll', () => {
	function AnchoredLog( { tops }: { tops: number[] } ) {
		const [ node, setNode ] = useState< HTMLDivElement | null >( null );
		const { spacerRef, isScrolledAway, scrollToLatest } = useAnchoredScroll( {
			scrollNode: node,
			sessionId: 'chat',
			content: tops,
			paused: false,
		} );
		return (
			<>
				<div ref={ setNode } data-testid="scroller">
					{ tops.map( ( top, index ) => (
						<div key={ index } data-scroll-anchor="" data-top={ top } />
					) ) }
					<div ref={ spacerRef } data-testid="spacer" />
				</div>
				<button
					type="button"
					data-visible={ isScrolledAway || undefined }
					onClick={ scrollToLatest }
				>
					Jump to latest
				</button>
			</>
		);
	}

	function renderLog( tops: number[] ) {
		const view = render( <AnchoredLog tops={ tops } /> );
		return {
			scroller: screen.getByTestId( 'scroller' ),
			spacer: screen.getByTestId( 'spacer' ),
			layOut: ( next: number[] ) => view.rerender( <AnchoredLog tops={ next } /> ),
		};
	}

	function layOutTall() {
		vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockReturnValue( 3000 );
		vi.spyOn( HTMLElement.prototype, 'clientHeight', 'get' ).mockReturnValue( 600 );
	}

	beforeEach( () => {
		vi.spyOn( Element.prototype, 'getBoundingClientRect' ).mockImplementation( function (
			this: Element
		) {
			return { top: Number( ( this as HTMLElement ).dataset.top ?? 0 ) } as DOMRect;
		} );
	} );

	it( 'opens a long chat at its last prompt, with a way back to the latest', async () => {
		layOutTall();
		const { scroller: node } = renderLog( [ 100, 900, 1500 ] );

		expect( node.scrollTop ).toBe( 1436 );
		await waitFor( () => expect( jumpButton() ).toHaveAttribute( 'data-visible' ) );
	} );

	it( 'holds the last prompt in place while images above it load, until the user scrolls', () => {
		layOutTall();
		const { scroller: node, layOut } = renderLog( [ 100, 900, 1500 ] );

		layOut( [ 100, 900, 964 ] );
		expect( node.scrollTop ).toBe( 2336 );

		fireEvent.wheel( node );
		layOut( [ 100, 900, 1200 ] );
		expect( node.scrollTop ).toBe( 2336 );
	} );

	it( 'stops holding once find in page scrolls the view', () => {
		layOutTall();
		const { scroller: node, layOut } = renderLog( [ 100, 900, 1500 ] );

		const lastPrompt = [ ...node.querySelectorAll< HTMLElement >( '[data-scroll-anchor]' ) ].at(
			-1
		)!;
		node.scrollTop = 400;
		lastPrompt.dataset.top = '2536';
		fireEvent.scroll( node );
		layOut( [ 100, 900, 964 ] );
		expect( node.scrollTop ).toBe( 400 );
	} );

	it( 'pins a new prompt near the top while its reply streams below', () => {
		const { scroller: node, spacer, layOut } = renderLog( [ 0 ] );

		setScrollMetrics( node, { scrollTop: 0, clientHeight: 600, scrollHeight: 1236 } );
		spacer.dataset.top = '800';
		layOut( [ 0, 700 ] );
		expect( spacer ).toHaveStyle( { height: '436px' } );
		expect( node.scrollTop ).toBe( 1236 );
		expect( jumpButton() ).not.toHaveAttribute( 'data-visible' );

		spacer.dataset.top = '1600';
		setScrollMetrics( node, { scrollTop: 0, scrollHeight: 1800 } );
		layOut( [ 0, 700 ] );
		expect( spacer ).toHaveStyle( { height: '0px' } );
		expect( node.scrollTop ).toBe( 1800 );
	} );

	it( 'stops following the moment the user scrolls up while a reply streams', async () => {
		const { scroller: node, layOut } = renderLog( [ 0 ] );
		setScrollMetrics( node, { scrollTop: 0, clientHeight: 600, scrollHeight: 1800 } );
		layOut( [ 0, 700 ] );
		expect( node.scrollTop ).toBe( 1800 );

		fireEvent.wheel( node, { deltaY: -40 } );
		setScrollMetrics( node, { scrollTop: 1800, scrollHeight: 3000 } );
		layOut( [ 0, 700 ] );

		expect( node.scrollTop ).toBe( 1800 );
		await waitFor( () => expect( jumpButton() ).toHaveAttribute( 'data-visible' ) );
	} );
} );

describe( 'isScrolledAwayFromLatest', () => {
	it.each( [
		{ case: 'at the very bottom', scrollTop: 600, scrollHeight: 1000, away: false },
		{ case: 'within the near-bottom threshold', scrollTop: 595, scrollHeight: 1000, away: false },
		{ case: 'scrolled beyond the threshold', scrollTop: 500, scrollHeight: 1000, away: true },
		{ case: 'when the content fits', scrollTop: 0, scrollHeight: 400, away: false },
	] )( 'is $away $case', ( { scrollTop, scrollHeight, away } ) => {
		expect( isScrolledAwayFromLatest( { scrollTop, scrollHeight, clientHeight: 400 } ) ).toBe(
			away
		);
	} );
} );
