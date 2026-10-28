import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests } from '@/data/app-messages';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import {
	changeAnnotation,
	removeAnnotations,
	getSiteAnnotations,
	pickAnnotation,
	setAnnotating,
} from '@/features/annotations';
import { clearComposerDrafts } from '@/features/composer';
import {
	createFakeConnector,
	makeSession,
	makeSite,
	TEST_USER,
	type FakeConnectorState,
} from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AiSessionSummary, Connector, SessionEntry, SiteDetails } from '@/data/core';

const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
let createdChats = 0;

function site( overrides: Partial< SiteDetails > = {} ) {
	return makeSite( { id: 'one', path: '/sites/my-site', ...overrides } );
}

function chat( overrides: Partial< AiSessionSummary >, entries: SessionEntry[] = [] ) {
	return {
		summary: makeSession( {
			ownerSiteId: 'one',
			ownerSitePath: '/sites/my-site',
			updatedAt: new Date().toISOString(),
			firstPrompt: overrides.title,
			...overrides,
		} ),
		entries,
	};
}

function prompt( text: string ) {
	return {
		type: 'custom',
		customType: 'studio.user_prompt',
		id: 'message',
		parentId: null,
		timestamp: new Date().toISOString(),
		data: { source: 'prompt', text },
	} as unknown as SessionEntry;
}

function setup( {
	sites = [ site() ],
	signedIn = false,
	path,
	overrides,
	...state
}: {
	sites?: SiteDetails[];
	signedIn?: boolean;
	path?: string;
	overrides?: Partial< Connector >;
} & Partial< FakeConnectorState > = {} ) {
	const connector = createFakeConnector(
		{
			sites,
			user: signedIn ? TEST_USER : null,
			...state,
			preferences: {
				autoCollapseSites: false,
				...state.preferences,
			} as FakeConnectorState[ 'preferences' ],
		},
		overrides
	);
	// Drafts outlive a render, keyed by chat id, so every chat gets a fresh one.
	connector.createSession.mockImplementation( async ( siteId ) => {
		const owner = connector.state.sites.find( ( entry ) => entry.id === siteId );
		const summary = makeSession( {
			id: `chat-${ ++createdChats }`,
			ownerSiteId: owner?.id,
			ownerSitePath: owner?.path,
			ownerSiteName: owner?.name,
		} );
		connector.state.sessions = [ ...connector.state.sessions, { summary, entries: [] } ];
		return summary;
	} );
	const view = renderApp( { connector, path } );
	const refreshSessions = async ( sessions: ReturnType< typeof chat >[] ) => {
		connector.state.sessions = [ ...connector.state.sessions, ...sessions ];
		await act( () => view.queryClient.invalidateQueries( { queryKey: [ 'sessions' ] } ) );
	};
	return { ...view, refreshSessions };
}

const composer = () => screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
const findComposer = () => screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );

async function paletteCommand( query: string ) {
	fireEvent.keyDown( document, { code: 'KeyK', key: 'k', metaKey: isApple, ctrlKey: ! isApple } );
	fireEvent.change( await screen.findByLabelText( 'Search commands' ), {
		target: { value: query },
	} );
	fireEvent.click( await screen.findByRole( 'option', { name: new RegExp( `^${ query }` ) } ) );
	await waitFor( () =>
		expect( screen.queryByLabelText( 'Search commands' ) ).not.toBeInTheDocument()
	);
}

beforeEach( () => {
	clearComposerDrafts();
	localStorage.clear();
	resetAppMessagesForTests();
} );

afterEach( () => {
	act( () => setCommandPaletteOpen( false ) );
} );

describe( 'Studio workspace', () => {
	it( 'asks for a provider before sending annotations and preserves notes when opening provider settings', async () => {
		const { history, connector } = setup( {
			path: '/sites/one',
			sites: [ site( { running: true } ) ],
		} );
		await screen.findByRole( 'toolbar', { hidden: true } );
		act( () => {
			setAnnotating( 'one', true );
			const id = pickAnnotation( 'one', { selector: 'h1', tag: 'h1', path: '/' } )!;
			changeAnnotation( 'one', id, { comment: 'Make this heading larger' } );
		} );
		try {
			fireEvent.click( screen.getByRole( 'button', { name: 'Send 1 annotation' } ) );
			expect(
				await screen.findByRole( 'dialog', { name: 'Put your feedback to work' } )
			).toBeVisible();
			expect( connector.createSession ).not.toHaveBeenCalled();
			expect( getSiteAnnotations( 'one' ).notes[ 0 ].comment ).toBe( 'Make this heading larger' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Choose a different provider' } ) );
			await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
			expect( getSiteAnnotations( 'one' ).notes ).toHaveLength( 1 );
		} finally {
			act( () => {
				removeAnnotations(
					'one',
					getSiteAnnotations( 'one' ).notes.map( ( note ) => note.id )
				);
				setAnnotating( 'one', false );
			} );
		}
	} );

	it.each( [ 'site', 'play' ] )(
		'opens a stopped site from %s without creating or resuming a chat',
		async ( action ) => {
			const { connector, history } = setup( {
				signedIn: true,
				sites: [ site(), site( { id: 'two', name: 'Other site', path: '/sites/other' } ) ],
				sessions: [
					chat( { id: 'previous', ownerSiteId: 'two', title: 'Previous conversation' }, [
						prompt( 'Old message' ),
					] ),
				],
				path: '/sites/one/new',
			} );
			await findComposer();
			fireEvent.click(
				screen.getByRole( 'button', {
					name: action === 'site' ? 'Other site' : 'Start Other site',
				} )
			);
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
			expect( await findComposer() ).toHaveValue( '' );
			expect( screen.queryByText( 'Old message' ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'button', { name: 'New chat' } ) ).not.toBeInTheDocument();
			expect( connector.createSession ).not.toHaveBeenCalled();
			if ( action === 'play' ) {
				await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
				expect( composer() ).toBeVisible();
			}
			fireEvent.click(
				within( screen.getByRole( 'group', { name: 'Sites' } ) ).getByRole( 'button', {
					name: 'Previous conversation',
				} )
			);
			expect( await screen.findByText( 'Old message' ) ).toBeVisible();
			fireEvent.click( screen.getByRole( 'button', { name: 'Other site' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
			expect( await findComposer() ).toHaveValue( '' );
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it( 'preserves each site’s text and attachments without listing unsent chats', async () => {
		const { connector } = setup( {
			signedIn: true,
			sites: [ site(), site( { id: 'two', name: 'Other site' } ) ],
		} );
		fireEvent.change( await findComposer(), { target: { value: 'Draft for my site' } } );
		fireEvent.change( document.querySelector( 'input[type="file"][multiple]' )!, {
			target: { files: [ new File( [ 'notes' ], 'draft.txt', { type: 'text/plain' } ) ] },
		} );
		await screen.findByText( 'draft.txt' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Other site' } ) );
		await waitFor( () => expect( composer() ).toHaveValue( '' ) );
		fireEvent.change( composer(), { target: { value: 'Draft for other site' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
		await waitFor( () => expect( composer() ).toHaveValue( 'Draft for my site' ) );
		expect( screen.getByText( 'draft.txt' ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Other site' } ) );
		await waitFor( () => expect( composer() ).toHaveValue( 'Draft for other site' ) );
		expect( screen.queryByText( 'draft.txt' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'New chat' } ) ).not.toBeInTheDocument();
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'leaves the draft workspace when its site is deleted', async () => {
		const { connector, queryClient, history } = setup( { signedIn: true } );
		await findComposer();
		connector.state.sites = [];
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'sites' ] } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites' ) );
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'restores a failed first message after switching sites and reuses its session on retry', async () => {
		const { connector } = setup( {
			signedIn: true,
			sites: [ site(), site( { id: 'two', name: 'Other site' } ) ],
		} );
		let rejectSend!: ( error: Error ) => void;
		connector.continueSession.mockImplementationOnce(
			() =>
				new Promise( ( _resolve, reject ) => {
					rejectSend = reject;
				} )
		);
		fireEvent.change( await findComposer(), { target: { value: 'Keep my failed message' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Other site' } ) );
		await waitFor( () =>
			expect( composer() ).toHaveAttribute( 'placeholder', 'Work with Other site' )
		);
		await act( async () => rejectSend( new Error( 'Send failed' ) ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
		await waitFor( () => expect( composer() ).toHaveValue( 'Keep my failed message' ) );
		expect( screen.queryByRole( 'button', { name: 'New chat' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 2 ) );
		expect( connector.createSession ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'lists a chat after its first message and leaves a fresh site draft', async () => {
		const { connector, history } = setup( { signedIn: true } );
		connector.continueSession.mockImplementation( async ( sessionId, text ) => {
			connector.state.sessions.find(
				( session ) => session.summary.id === sessionId
			)!.summary.firstPrompt = text;
			return { runId: 'gallery-run' };
		} );
		fireEvent.change( await findComposer(), { target: { value: 'Build a gallery' } } );
		expect( connector.createSession ).not.toHaveBeenCalled();
		expect( screen.queryByRole( 'button', { name: /Build a gallery/ } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( history.location.pathname ).toMatch( /^\/sessions\// ) );
		expect(
			await within( screen.getByRole( 'group', { name: 'Sites' } ) ).findByRole( 'button', {
				name: /Build a gallery/,
			} )
		).toBeVisible();
		expect( connector.createSession ).toHaveBeenCalledTimes( 1 );
		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		expect( await findComposer() ).toHaveValue( '' );
		expect( connector.createSession ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps Share and Publish available while authentication is loading', async () => {
		const { connector } = setup( { sites: [ site( { running: true } ) ] } );
		connector.getAuthUser.mockImplementation( () => new Promise( () => {} ) );
		expect( await screen.findByRole( 'button', { name: 'Share' } ) ).toBeVisible();
		expect( await screen.findByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
	} );

	it( 'keeps Share and Publish available through account changes and opens contextual account copy', async () => {
		const { connector, queryClient } = setup( { sites: [ site( { running: true } ) ] } );
		expect( await screen.findByRole( 'button', { name: 'Share' } ) ).toBeVisible();
		expect( await screen.findByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
		await paletteCommand( 'Publish & Sync' );
		expect( await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } ) ).toBeVisible();
		expect( connector.authenticate ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		connector.state.user = TEST_USER;
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'auth-user' ] } ) );
		expect( await screen.findByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeVisible();
		connector.state.user = null;
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'auth-user' ] } ) );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeVisible();
	} );

	it( 'keeps an established header during a background site refresh', async () => {
		const { connector, queryClient } = setup( { sites: [ site( { running: true } ) ] } );
		const publish = await screen.findByRole( 'button', { name: 'Publish…' } );
		const address = await screen.findByRole( 'textbox', { name: 'Address' } );
		let finish!: ( sites: SiteDetails[] ) => void;
		connector.getSites.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		act( () => {
			void queryClient.invalidateQueries( { queryKey: [ 'sites' ] } );
		} );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toBe( address );
		await act( async () => finish( [ site( { running: true } ) ] ) );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
	} );

	it( 'allows manual startup while offline', async () => {
		const online = vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		try {
			const { connector } = setup( { signedIn: true } );
			await screen.findByText( 'You are offline. Reconnect to send a message.' );
			expect( composer() ).toBeEnabled();
			fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
			await screen.findByLabelText( 'Site preview' );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
		} finally {
			online.mockRestore();
		}
	} );

	it( 'allows manual startup when AI credits are exhausted', async () => {
		const { connector } = setup( { signedIn: true } );
		connector.getStudioAssistantQuota.mockResolvedValue( {
			costUsage: 0,
			costCap: 500000,
			costResetDate: '',
			emailVerified: true,
			hasPaymentMethod: true,
			studioCodeAiHasAccess: true,
			studioCodeAiAccess: 'granted',
			allowanceRemaining: 0,
			purchasedRemaining: 0,
			purchasedAtTopUp: 0,
		} as never );
		await screen.findByText( 'Add AI credits to send another message.' );
		expect( composer() ).toBeEnabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		await screen.findByLabelText( 'Site preview' );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
	} );

	it( 'keeps manual startup available when AI needs setup', async () => {
		setup();
		expect( await screen.findByRole( 'button', { name: 'Start My site' } ) ).toBeEnabled();
		expect( await findComposer() ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Send message' } ) ).toBeDisabled();
		expect( screen.queryByRole( 'button', { name: 'Close chat' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps a resolved live preview beside chat while the local site is stopped', async () => {
		const { connector, refreshSessions, history } = setup( {
			signedIn: true,
			overrides: {
				getConnectedWpcomSites: async () =>
					[ { id: 123, url: 'https://example.test', name: 'Live site' } ] as never,
			},
		} );
		await findComposer();
		await refreshSessions( [
			chat( {
				id: 'live-chat',
				title: 'Live conversation',
				activeEnvironment: 'live',
				lastSelectedWpcomSiteId: 123,
			} ),
		] );
		fireEvent.click(
			await within( screen.getByRole( 'group', { name: 'Sites' } ) ).findByRole( 'button', {
				name: /^Live conversation$/,
			} )
		);
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/live-chat' ) );
		await waitFor( () =>
			expect( document.querySelector( 'iframe' ) ).toHaveAttribute( 'src', 'https://example.test/' )
		);
		expect( composer() ).toBeVisible();
		expect( connector.startSite ).not.toHaveBeenCalled();
	} );

	it( 'keeps chat beside the preview after manual startup', async () => {
		const { connector } = setup( {
			signedIn: true,
			sites: [
				site( { running: true } ),
				site( { id: 'two', name: 'Stopped site', path: '/sites/stopped' } ),
			],
		} );
		await findComposer();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Close chat' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stopped site' } ) );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		const input = await findComposer();
		expect( input ).toBeVisible();
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Start Stopped site' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'two' ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		expect( await findComposer() ).toHaveValue( 'Keep this draft' );
		expect( screen.getByRole( 'button', { name: 'Close chat' } ) ).toBeVisible();
	} );

	it( 'keeps the chat draft while starting a site and recovering from a start failure', async () => {
		const { connector } = setup( { signedIn: true } );
		connector.startSite.mockRejectedValueOnce( new Error( 'Start failed' ) );
		const input = await findComposer();
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		const createCalls = connector.createSession.mock.calls.length;
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Start My site' } ) ).toBeEnabled()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		expect( input ).toHaveValue( 'Keep this draft' );
		expect( connector.createSession ).toHaveBeenCalledTimes( createCalls );
	} );

	it.each( [ 'Settings', 'Rename' ] )(
		'keeps chat hidden when opening and closing %s from site actions',
		async ( action ) => {
			const { history } = setup( {
				signedIn: true,
				sites: [ site( { running: true } ) ],
				sessions: [ chat( { id: 'settings-chat', title: 'Existing chat' } ) ],
				path: '/sessions/settings-chat',
			} );
			await screen.findByRole( 'button', { name: 'Close chat' } );
			const input = await findComposer();
			await waitFor( () => expect( input ).toBeEnabled() );
			fireEvent.change( input, { target: { value: 'Keep this draft' } } );
			fireEvent.click( await screen.findByRole( 'button', { name: 'Close chat' } ) );
			await waitFor( () => expect( input.closest( '[aria-hidden="true"]' ) ).not.toBeNull() );
			const chatPanel = input.closest( '[aria-hidden="true"]' )!;
			fireEvent.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
			fireEvent.click( await screen.findByRole( 'menuitem', { name: action } ) );
			expect( await screen.findByRole( 'dialog', { name: 'Settings' } ) ).toBeVisible();
			expect( chatPanel ).toHaveAttribute( 'aria-hidden', 'true' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
			await waitFor( () =>
				expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument()
			);
			expect( chatPanel ).toHaveAttribute( 'aria-hidden', 'true' );
			expect( history.location.pathname ).toBe( '/sessions/settings-chat' );
			expect( input ).toHaveValue( 'Keep this draft' );
			fireEvent.click(
				within( screen.getByRole( 'group', { name: 'Sites' } ) ).getByRole( 'button', {
					name: 'Existing chat',
				} )
			);
			await waitFor( () => expect( chatPanel ).not.toHaveAttribute( 'aria-hidden', 'true' ) );
		}
	);

	it( 'keeps one workspace header and chat toggle while preserving the draft', async () => {
		setup( {
			signedIn: true,
			sites: [ site( { running: true } ) ],
			sessions: [ chat( { id: 'hidden-chat', title: 'Existing chat' } ) ],
			path: '/sessions/hidden-chat',
		} );
		const toggle = await screen.findByRole( 'button', { name: 'Close chat', pressed: true } );
		const input = await findComposer();
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Keep this unsent idea' } } );
		const menu = screen.getByRole( 'button', { name: 'Site menu' } );
		const header = screen
			.getByRole( 'textbox', { name: 'Address' } )
			.closest< HTMLElement >( '[data-site-header]' );
		expect( header ).toContainElement( menu );
		expect( header ).toContainElement( toggle );
		expect( screen.getByRole( 'main' ).querySelectorAll( '[data-site-header]' ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'complementary', { name: 'Site preview' } ) ).not.toContainElement(
			header
		);
		const frame = document.querySelector( 'iframe' );
		toggle.focus();
		fireEvent.click( toggle );
		await waitFor( () => expect( input.closest( '[aria-hidden="true"]' ) ).not.toBeNull() );
		expect( screen.getByRole( 'button', { name: 'Open chat', pressed: false } ) ).toBe( toggle );
		expect( toggle ).toHaveFocus();
		expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toBe( menu );
		fireEvent.click( toggle );
		await waitFor( () => expect( input.closest( '[aria-hidden="true"]' ) ).toBeNull() );
		expect( screen.getByRole( 'button', { name: 'Close chat', pressed: true } ) ).toBe( toggle );
		expect( input ).toHaveValue( 'Keep this unsent idea' );
		expect( document.querySelector( 'iframe' ) ).toBe( frame );
	} );

	it( 'opens a new draft when the chat panel is hidden', async () => {
		const { connector, history } = setup( {
			signedIn: true,
			sites: [ site( { running: true } ) ],
		} );
		await findComposer();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Close chat' } ) );
		await waitFor( () =>
			expect(
				screen
					.getByRole( 'combobox', { name: 'Message WordPress Studio', hidden: true } )
					.closest( '[aria-hidden="true"]' )
			).not.toBeNull()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
		await waitFor( () => expect( composer().closest( '[aria-hidden="true"]' ) ).toBeNull() );
		expect( history.location.pathname ).toBe( '/sites/one/new' );
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'focuses the existing draft from the sidebar when no preview is showing', async () => {
		const { connector } = setup( { signedIn: true } );
		const input = await findComposer();
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		const newChat = screen.getByRole( 'button', { name: 'New chat for My site' } );
		for ( let index = 0; index < 2; index++ ) {
			newChat.focus();
			fireEvent.click( newChat );
			await waitFor( () => expect( composer() ).toHaveFocus() );
			expect( composer() ).toHaveValue( 'Keep this draft' );
		}
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it.each( [
		[ false, false ],
		[ false, true ],
		[ true, false ],
		[ true, true ],
	] )(
		'focuses a new draft when switching sites (source running: %s, target running: %s)',
		async ( sourceRunning, targetRunning ) => {
			const { connector } = setup( {
				sites: [
					site( { running: sourceRunning } ),
					site( { id: 'two', name: 'Other site', running: targetRunning } ),
				],
			} );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			const newChat = screen.getByRole( 'button', { name: 'New chat for Other site' } );
			newChat.focus();
			fireEvent.click( newChat );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			await waitFor( () => expect( composer() ).toHaveFocus() );
			expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toBeVisible();
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it( 'preserves an unsent draft when toggling chat from the sidebar', async () => {
		const { connector } = setup( { signedIn: true, sites: [ site( { running: true } ) ] } );
		await findComposer();
		for ( let index = 0; index < 3; index++ ) {
			fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
			const input = await findComposer();
			await waitFor( () => expect( input ).toBeEnabled() );
			fireEvent.change( input, { target: { value: 'Unsent draft' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
		}
		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
		await waitFor( () => expect( composer() ).toHaveValue( 'Unsent draft' ) );
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'starts a fresh draft from the sidebar when the selected chat has messages', async () => {
		const { connector, history, refreshSessions } = setup( {
			signedIn: true,
			sites: [ site( { running: true } ) ],
		} );
		await findComposer();
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		const draftChat = history.location.pathname;
		await refreshSessions( [
			chat( { id: 'existing-chat', title: 'Existing conversation' }, [
				prompt( 'Existing message' ),
			] ),
		] );
		fireEvent.click(
			await within( screen.getByRole( 'group', { name: 'Sites' } ) ).findByRole( 'button', {
				name: 'Existing conversation',
			} )
		);
		await screen.findByText( 'Existing message' );
		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( draftChat ) );
		expect( await findComposer() ).toHaveValue( '' );
		expect( screen.queryByText( 'Existing message' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'New chat for My site' } ) ).toBeVisible();
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'creates a conversation on first send and retries a failed send without creating another', async () => {
		const { connector } = setup( { signedIn: true } );
		connector.continueSession
			.mockRejectedValueOnce( new Error( 'Send failed' ) )
			.mockResolvedValue( { runId: 'first-run' } as never );
		const input = await findComposer();
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Help me plan this site' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
		await waitFor( () => expect( input ).toHaveValue( 'Help me plan this site' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 2 ) );
		expect( connector.createSession ).toHaveBeenCalledTimes( 1 );
		expect( connector.createSession ).toHaveBeenCalledWith( 'one' );
		expect( await screen.findByText( 'Help me plan this site' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Start My site' } ) ).toBeVisible();
		expect( document.querySelector( 'iframe' ) ).toBeNull();
		expect( connector.startSite ).not.toHaveBeenCalled();
	} );

	it( 'keeps saved chat drafts when starting an unsaved new chat', async () => {
		const { connector, history, refreshSessions } = setup( {
			signedIn: true,
			sites: [ site( { running: true } ) ],
		} );
		await findComposer();
		await refreshSessions( [
			chat( { id: 'saved-draft', title: 'Saved chat' }, [ prompt( 'Saved message' ) ] ),
		] );
		const sites = within( screen.getByRole( 'group', { name: 'Sites' } ) );
		fireEvent.click( await sites.findByRole( 'button', { name: 'Saved chat' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/saved-draft' ) );
		await screen.findByText( 'Saved message' );
		const input = await findComposer();
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Draft for saved chat' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
		await waitFor( () => expect( history.location.pathname ).not.toBe( '/sessions/saved-draft' ) );
		await waitFor( () => expect( composer() ).toHaveValue( '' ) );
		fireEvent.click( sites.getByRole( 'button', { name: 'Saved chat' } ) );
		await waitFor( () => expect( composer() ).toHaveValue( 'Draft for saved chat' ) );
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );
	it.each( [ false, true ] )(
		'waits for an uncached chat before showing access controls (signed in: %s)',
		async ( signedIn ) => {
			const { connector, history, refreshSessions } = setup( { signedIn } );
			await findComposer();
			const summary = makeSession( {
				id: 'delayed-chat',
				firstPrompt: 'Delayed message',
				title: 'Delayed conversation',
				ownerSiteId: 'one',
				ownerSitePath: '/sites/my-site',
				updatedAt: new Date().toISOString(),
			} );
			let resolveSession!: ( value: {
				summary: AiSessionSummary;
				entries: SessionEntry[];
			} ) => void;
			const loadSession = connector.getSession.getMockImplementation()!;
			connector.getSession.mockImplementation( ( id ) =>
				id === summary.id
					? new Promise( ( resolve ) => {
							resolveSession = resolve;
					  } )
					: loadSession( id )
			);
			await refreshSessions( [ { summary, entries: [] } ] );
			fireEvent.click(
				await within( screen.getByRole( 'group', { name: 'Sites' } ) ).findByRole( 'button', {
					name: 'Delayed conversation',
				} )
			);
			await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/delayed-chat' ) );
			await waitFor( () => expect( connector.getSession ).toHaveBeenCalledWith( summary.id ) );
			expect(
				screen.queryByRole( 'button', { name: /Chat actions for/ } )
			).not.toBeInTheDocument();
			expect(
				screen.queryByText( 'Connect a provider to build and edit your site.' )
			).not.toBeInTheDocument();
			const pending = screen.queryByRole( 'combobox', { name: 'Message WordPress Studio' } );
			if ( pending ) {
				expect( pending ).toBeDisabled();
				expect( screen.getByRole( 'button', { name: 'Send message' } ) ).toBeDisabled();
			}
			await act( async () =>
				resolveSession( { summary, entries: [ prompt( 'Existing conversation content' ) ] } )
			);
			expect( await screen.findByText( 'Existing conversation content' ) ).toBeVisible();
			expect( await findComposer() ).toBeVisible();
		}
	);

	it( 'keeps site actions in the conversation toolbar before the preview is running', async () => {
		const { connector, history, refreshSessions } = setup( { signedIn: true } );
		await findComposer();
		for ( const name of [ 'Address', 'Back', 'Forward', 'Reload preview' ] ) {
			expect( screen.queryByRole( 'button', { name } ) ).not.toBeInTheDocument();
		}
		expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeVisible();
		await refreshSessions( [ chat( { id: 'toolbar-chat', title: 'Plan my site' } ) ] );
		fireEvent.click(
			await within( screen.getByRole( 'group', { name: 'Sites' } ) ).findByRole( 'button', {
				name: 'Plan my site',
			} )
		);
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/toolbar-chat' ) );
		expect( screen.queryByRole( 'button', { name: /Chat actions/ } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Site menu' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Annotate' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument()
		);
		expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Stop' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop site' } ) );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'one' ) );
		expect( await screen.findByRole( 'button', { name: 'Start My site' } ) ).toBeVisible();
	} );

	it( 'preserves draft and attachments through external start and stop events', async () => {
		const { connector } = setup( { signedIn: true } );
		const input = await findComposer();
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		fireEvent.change( document.querySelector( 'input[type="file"][multiple]' )!, {
			target: { files: [ new File( [ 'notes' ], 'notes.txt', { type: 'text/plain' } ) ] },
		} );
		await screen.findByText( 'notes.txt' );
		input.focus();
		const model = screen
			.getByRole( 'button', { name: 'Model' } )
			.getAttribute( 'aria-description' );
		const emitSites = async ( next: SiteDetails ) => {
			connector.state.sites = [ next ];
			await act( async () =>
				connector.emit( 'onSiteEvent', {
					event: SITE_EVENTS.UPDATED,
					siteId: 'one',
					running: !! next.running,
				} )
			);
		};
		await emitSites( site( { running: true, operation: { kind: 'start', pid: 1 } } as never ) );
		await waitFor( () =>
			expect(
				within( screen.getByRole( 'group', { name: 'Sites' } ) ).getByRole( 'button', {
					name: 'Starting',
				} )
			).toHaveAttribute( 'aria-disabled', 'true' )
		);
		expect( input ).toBeEnabled();
		expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
		for ( const running of [ true, false, true ] ) {
			await emitSites( site( { running } ) );
			if ( running ) {
				await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
				fireEvent.load( document.querySelector( 'iframe' )! );
			}
			await waitFor( () =>
				expect( !! screen.queryByRole( 'textbox', { name: 'Address' } ) ).toBe( running )
			);
			expect( composer() ).toBe( input );
			expect( input ).toHaveValue( 'Keep this draft' );
			expect( screen.getByText( 'notes.txt' ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Model' } ) ).toHaveAttribute(
				'aria-description',
				model!
			);
		}
		expect( connector.createSession ).not.toHaveBeenCalled();
	} );

	it( 'toggles chat full screen through the palette without replacing its draft', async () => {
		const { history } = setup( {
			signedIn: true,
			sites: [ site( { running: true } ) ],
			sessions: [ chat( { id: 'fullscreen-chat', title: 'Palette chat' } ) ],
		} );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/fullscreen-chat' ) );
		const input = await findComposer();
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		await screen.findByRole( 'button', { name: 'Publish…' } );
		await paletteCommand( 'Hide preview' );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible()
		);
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeVisible();
		await paletteCommand( 'Show preview' );
		expect( await screen.findByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
		expect( composer() ).toBe( input );
		expect( input ).toHaveValue( 'Keep this draft' );
	} );

	describe( 'automatic site startup on chat', () => {
		async function prepare( enabled = true, ownerSite = site() ) {
			const state = setup( {
				signedIn: true,
				sites: [ ownerSite ],
				preferences: { autoStartSiteOnChat: enabled } as never,
			} );
			state.connector.continueSession.mockResolvedValue( { runId: 'auto-start-run' } );
			const input = await findComposer();
			await waitFor( () => expect( input ).toBeEnabled() );
			return { ...state, input };
		}

		it( 'sends immediately while startup is pending and does not start again for queued messages', async () => {
			const { connector, input } = await prepare();
			let finishStart!: () => void;
			connector.startSite.mockImplementation(
				( id ) =>
					new Promise( ( resolve ) => {
						finishStart = () => {
							connector.state.sites = [ site( { id, running: true } ) ];
							resolve();
						};
					} )
			);
			fireEvent.change( input, { target: { value: 'Build a home page' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
			await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
			expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' );
			expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
			expect( document.querySelector( 'iframe' ) ).toBeNull();
			const nextInput = composer();
			fireEvent.change( nextInput, { target: { value: 'Add a footer too' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Queue message' } ) );
			await waitFor( () => expect( nextInput ).toHaveValue( '' ) );
			expect( connector.startSite ).toHaveBeenCalledTimes( 1 );
			expect( connector.continueSession ).toHaveBeenCalledTimes( 1 );
			await act( async () => finishStart() );
			await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
			expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
			fireEvent.load( document.querySelector( 'iframe' )! );
			expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
		} );

		it.each( [
			[ 'disabled preference', false, site() ],
			[ 'running site', true, site( { running: true } ) ],
			[ 'pending site operation', true, site( { operation: { kind: 'start', pid: 1 } } as never ) ],
		] as const )( 'does not start for %s', async ( _label, enabled, ownerSite ) => {
			const { connector, input } = await prepare( enabled, ownerSite );
			fireEvent.change( input, { target: { value: 'Help me plan' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
			await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
			expect( connector.startSite ).not.toHaveBeenCalled();
			expect( composer() ).toHaveValue( '' );
		} );

		it( 'reports startup failure without restoring a sent prompt', async () => {
			const { connector, input } = await prepare();
			connector.startSite.mockRejectedValue( new Error( 'Startup failed' ) );
			fireEvent.change( input, { target: { value: 'Build a home page' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
			await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
			await waitFor( () => expect( composer() ).toHaveValue( '' ) );
			await waitFor( () =>
				expect(
					getNoticeHistory().some( ( item ) => item.description?.includes( 'Startup failed' ) )
				).toBe( true )
			);
		} );

		it( 'enables through slash selection, preserves the prompt and synchronizes the removable chip with settings', async () => {
			const { connector, input } = await prepare( false );
			fireEvent.change( input, { target: { value: 'Keep this text /auto' } } );
			fireEvent.keyDown( input, { key: 'Enter' } );
			const chip = await screen.findByRole( 'button', { name: 'Remove Auto-start' } );
			expect( input ).toHaveValue( 'Keep this text ' );
			expect( connector.startSite ).not.toHaveBeenCalled();
			expect( connector.continueSession ).not.toHaveBeenCalled();
			fireEvent.click( screen.getByRole( 'button', { name: /^Settings$/ } ) );
			const setting = await screen.findByRole( 'switch', {
				name: /Start site when sending a prompt/,
			} );
			expect( setting ).toBeChecked();
			fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
			fireEvent.click( chip );
			await waitFor( () =>
				expect(
					screen.queryByRole( 'button', { name: 'Remove Auto-start' } )
				).not.toBeInTheDocument()
			);
			expect( connector.state.preferences.autoStartSiteOnChat ).toBe( false );
		} );

		it( 'restores a failed prompt even when site startup succeeds', async () => {
			const { connector, input } = await prepare();
			connector.continueSession.mockRejectedValue( new Error( 'Send failed' ) );
			fireEvent.change( input, { target: { value: 'Keep my draft' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
			await waitFor( () => expect( composer() ).toHaveValue( 'Keep my draft' ) );
			expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' );
		} );

		it( 'does not start the local site for a live conversation', async () => {
			const { connector, history, refreshSessions } = setup( {
				signedIn: true,
				preferences: { autoStartSiteOnChat: true } as never,
				overrides: {
					getConnectedWpcomSites: async () =>
						[ { id: 123, url: 'https://example.test', name: 'Live site' } ] as never,
				},
			} );
			await findComposer();
			await refreshSessions( [
				chat( {
					id: 'live-chat',
					title: 'Live conversation',
					activeEnvironment: 'live',
					lastSelectedWpcomSiteId: 123,
				} ),
			] );
			fireEvent.click(
				await within( screen.getByRole( 'group', { name: 'Sites' } ) ).findByRole( 'button', {
					name: /^Live conversation$/,
				} )
			);
			await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/live-chat' ) );
			const input = await findComposer();
			await waitFor( () => expect( input ).toBeEnabled() );
			fireEvent.change( input, { target: { value: 'Review my live site' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
			await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
			expect( connector.startSite ).not.toHaveBeenCalled();
		} );

		it( 'keeps the preference disabled when saving fails', async () => {
			const { connector, input } = await prepare( false );
			connector.setUserPreferences.mockRejectedValue( new Error( 'Preference failed' ) );
			fireEvent.change( input, { target: { value: '/auto-start' } } );
			fireEvent.click( await screen.findByRole( 'option', { name: /auto-start/i } ) );
			await waitFor( () =>
				expect( connector.setUserPreferences ).toHaveBeenCalledWith(
					{ autoStartSiteOnChat: true },
					undefined
				)
			);
			await waitFor( () =>
				expect(
					screen.queryByRole( 'button', { name: 'Remove Auto-start' } )
				).not.toBeInTheDocument()
			);
			expect( connector.startSite ).not.toHaveBeenCalled();
		} );
	} );
} );
