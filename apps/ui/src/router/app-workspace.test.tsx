import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests } from '@/data/app-messages';
import {
	PREVIEW_OPEN_STORAGE_KEY,
	SITE_CHAT_HIDDEN_STORAGE_KEY,
	PREVIEW_LAYOUT_STORAGE_KEY,
} from '@/data/resizable-panels';
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
const composerStartButton = () =>
	within( composer().closest( '[role="group"]' )! ).getByRole( 'button', { name: 'Start site' } );
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

async function setChatFullscreen( fullscreen: boolean ) {
	await screen.findByRole( 'button', { name: 'Hide preview' } );
	await paletteCommand( fullscreen ? 'Hide chat' : 'Show chat' );
}

async function waitForFullscreen( fullscreen: boolean ) {
	await waitFor( () => {
		const input = screen.getByRole( 'combobox', {
			name: 'Message WordPress Studio',
			hidden: true,
		} );
		expect( !! input.closest( '[aria-hidden="true"]' ) ).toBe( fullscreen );
	} );
	return screen.findByRole( 'button', { name: 'Hide preview' } );
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
		await screen.findByRole( 'toolbar', { name: 'Preview browser controls' } );
		act( () => {
			setAnnotating( 'one', true );
			const id = pickAnnotation( 'one', { selector: 'h1', tag: 'h1', path: '/' } )!;
			changeAnnotation( 'one', id, { comment: 'Make this heading larger' } );
		} );
		try {
			fireEvent.click(
				within( screen.getByRole( 'toolbar', { name: 'Annotations' } ) ).getByRole( 'button', {
					name: 'Send 1 annotation',
				} )
			);
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
		'opens a stopped site from %s without resuming a conversation',
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
			await waitFor( () =>
				expect( history.location.pathname ).toBe(
					action === 'play' ? '/sessions/previous' : '/sites/two/new'
				)
			);
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
		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
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

	it.each( [ 'thumbnail', 'composer' ] as const )(
		'reveals a hidden preview when starting with the %s',
		async ( control ) => {
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
			const { connector } = setup( {
				signedIn: true,
				path: '/sites/one/new',
				overrides: { getSiteThumbnail: async () => 'data:image/png;base64,eA==' },
			} );
			const input = await findComposer();
			expect( screen.getByRole( 'button', { name: 'Show preview' } ) ).toBeVisible();
			const play =
				control === 'thumbnail'
					? await screen.findByRole( 'button', { name: 'Start from preview' } )
					: within( input.closest( '[role="group"]' )! ).getByRole( 'button', {
							name: 'Start site',
					  } );
			fireEvent.click( play );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
			fireEvent.load( document.querySelector( 'iframe' )! );
			expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
			expect( composer() ).toBe( input );
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it( 'opens the preview over chat when starting from the composer on a narrow screen', async () => {
		const matchMedia = window.matchMedia.bind( window );
		const mediaSpy = vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query ) => ( {
			...matchMedia( query ),
			matches: query === '(max-width: 540px)',
		} ) );
		try {
			const { connector } = setup( { signedIn: true, path: '/sites/one/new' } );
			const input = await findComposer();
			fireEvent.click(
				within( input.closest( '[role="group"]' )! ).getByRole( 'button', { name: 'Start site' } )
			);
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
			fireEvent.load( document.querySelector( 'iframe' )! );
			expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
			await waitFor( () =>
				expect(
					screen.queryByRole( 'combobox', { name: 'Message WordPress Studio' } )
				).not.toBeInTheDocument()
			);
			expect( screen.getByRole( 'button', { name: 'Exit fullscreen' } ) ).toBeVisible();
		} finally {
			mediaSpy.mockRestore();
		}
	} );

	it( 'keeps a full-width site preview open when starting from its thumbnail', async () => {
		const { connector, history } = setup( {
			signedIn: true,
			path: '/sites/one',
			preferences: { openChatOnSiteStart: false } as FakeConnectorState[ 'preferences' ],
			overrides: { getSiteThumbnail: async () => 'data:image/png;base64,eA==' },
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Start from preview' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
		expect( history.location.pathname ).toBe( '/sites/one' );
		expect(
			screen.queryByRole( 'combobox', { name: 'Message WordPress Studio' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps manual startup available when AI needs setup', async () => {
		setup();
		expect( await screen.findByRole( 'button', { name: 'Start My site' } ) ).toBeEnabled();
		expect( await findComposer() ).toBeEnabled();
		expect( composerStartButton() ).toBeEnabled();
		expect( screen.queryByRole( 'button', { name: 'Enter fullscreen' } ) ).not.toBeInTheDocument();
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
		await setChatFullscreen( true );
		fireEvent.click( screen.getByRole( 'button', { name: 'Stopped site' } ) );
		await screen.findByRole( 'button', { name: 'Site menu' } );
		await waitForFullscreen( true );
		await setChatFullscreen( false );
		const input = await findComposer();
		expect( input ).toBeVisible();
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Start Stopped site' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'two' ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		expect( await findComposer() ).toHaveValue( 'Keep this draft' );
		expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toBeVisible();
	} );

	it.each( [ 'thumbnail', 'composer' ] as const )(
		'reveals the preview when starting from full-width chat using the %s',
		async ( control ) => {
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
			const { connector } = setup( {
				signedIn: true,
				path: '/sites/one/new',
				overrides: { getSiteThumbnail: async () => 'data:image/png;base64,eA==' },
			} );
			const input = await findComposer();
			await waitFor( () => expect( input ).toBeEnabled() );
			if ( control === 'thumbnail' )
				fireEvent.change( input, { target: { value: 'Keep this draft' } } );
			let finishStart!: () => void;
			connector.startSite.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						finishStart = () => {
							connector.state.sites = [ site( { running: true } ) ];
							resolve();
						};
					} )
			);
			const play =
				control === 'thumbnail'
					? await screen.findByRole( 'button', { name: 'Start from preview' } )
					: composerStartButton();
			fireEvent.click( play );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			const panel = await screen.findByRole( 'complementary', { name: 'Site preview' } );
			expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toHaveAttribute(
				'aria-expanded',
				'true'
			);
			await act( async () => finishStart() );
			await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
			fireEvent.load( document.querySelector( 'iframe' )! );
			expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
			expect( panel ).toContainElement( document.querySelector( 'iframe' ) );
			expect( composer() ).toBe( input );
			expect( input ).toHaveValue( control === 'thumbnail' ? 'Keep this draft' : '' );
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it.each( [ '/sites/one', '/sites/one/new' ] )(
		'starts into a full-width preview with chat-on-start disabled from %s',
		async ( path ) => {
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
			localStorage.setItem( SITE_CHAT_HIDDEN_STORAGE_KEY, JSON.stringify( { one: true } ) );
			const { connector, history } = setup( {
				signedIn: true,
				path,
				preferences: { openChatOnSiteStart: false } as FakeConnectorState[ 'preferences' ],
				overrides: { getSiteThumbnail: async () => 'data:image/png;base64,eA==' },
			} );
			if ( path.endsWith( '/new' ) ) {
				await findComposer();
				fireEvent.click( screen.getByRole( 'button', { name: 'Show preview' } ) );
			}
			const panel = await screen.findByRole( 'complementary', { name: 'Site preview' } );
			let finishStart!: () => void;
			connector.startSite.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						finishStart = () => {
							connector.state.sites = [ site( { running: true } ) ];
							resolve();
						};
					} )
			);
			fireEvent.click(
				await within( panel ).findByRole( 'button', { name: 'Start from preview' } )
			);
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			expect( await screen.findByRole( 'button', { name: 'Exit fullscreen' } ) ).toBeVisible();
			expect( history.location.pathname ).toBe( path );
			await act( async () => finishStart() );
			await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
			fireEvent.load( document.querySelector( 'iframe' )! );
			expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Exit fullscreen' } ) ).toBeVisible();
			expect( panel ).toContainElement( document.querySelector( 'iframe' ) );
		}
	);

	it( 'reveals the preview full width when Play is pressed in a narrow chat', async () => {
		const matchMedia = window.matchMedia.bind( window );
		const media = vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query ) => ( {
			...matchMedia( query ),
			matches: query === '(max-width: 540px)' || matchMedia( query ).matches,
		} ) );
		try {
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
			const { connector } = setup( {
				signedIn: true,
				path: '/sites/one/new',
				overrides: { getSiteThumbnail: async () => 'data:image/png;base64,eA==' },
			} );
			const input = await findComposer();
			fireEvent.click( await screen.findByRole( 'button', { name: 'Start from preview' } ) );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
			fireEvent.load( document.querySelector( 'iframe' )! );
			expect( await screen.findByRole( 'button', { name: 'Exit fullscreen' } ) ).toBeVisible();
			await waitFor( () => expect( input.closest( '[aria-hidden="true"]' ) ).not.toBeNull() );
			expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toHaveAttribute(
				'aria-expanded',
				'true'
			);
		} finally {
			media.mockRestore();
		}
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
			await waitForFullscreen( false );
			const input = await findComposer();
			await waitFor( () => expect( input ).toBeEnabled() );
			fireEvent.change( input, { target: { value: 'Keep this draft' } } );
			await setChatFullscreen( true );
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

	it( 'keeps preview available before and after starting from the composer', async () => {
		localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
		const { connector } = setup( { signedIn: true } );
		await findComposer();
		const publish = screen.getByRole( 'button', { name: 'Publish…' } );
		const actions = publish.closest< HTMLElement >( '[data-site-header-actions]' )!;
		expect(
			within( actions ).queryByRole( 'button', { name: 'Start site' } )
		).not.toBeInTheDocument();
		expect( within( actions ).getByRole( 'button', { name: 'Show preview' } ) ).toHaveAttribute(
			'aria-disabled',
			'false'
		);
		fireEvent.click( composerStartButton() );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
		await waitFor( () =>
			expect( within( actions ).getByRole( 'button', { name: 'Hide preview' } ) ).toBeVisible()
		);
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
		expect( screen.queryByRole( 'button', { name: 'Stop site' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Hide preview' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument()
		);
		expect(
			within( actions ).queryByRole( 'button', { name: 'Stop site' } )
		).not.toBeInTheDocument();
	} );

	it.each( [ false, true ] )(
		'shows a stopped preview beside the existing chat without starting it (thumbnail: %s)',
		async ( thumbnail ) => {
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
			const { connector } = setup( {
				signedIn: true,
				overrides: {
					getSiteThumbnail: async () => ( thumbnail ? 'data:image/png;base64,eA==' : null ),
				},
			} );
			const input = await findComposer();
			fireEvent.change( input, { target: { value: 'Keep this draft' } } );
			const publish = screen.getByRole( 'button', { name: 'Publish…' } );
			const chatThumbnail = thumbnail
				? await screen.findByRole( 'button', { name: 'Start from preview' } )
				: null;
			fireEvent.click( screen.getByRole( 'button', { name: 'Show preview' } ) );
			const panel = await screen.findByRole( 'complementary', { name: 'Site preview' } );
			const start = await within( panel ).findByRole( 'button', {
				name: thumbnail ? 'Start from preview' : 'Start site',
			} );
			expect( connector.startSite ).not.toHaveBeenCalled();
			expect( connector.createSession ).not.toHaveBeenCalled();
			expect( panel ).not.toContainElement( input );
			expect(
				screen.getAllByRole( 'combobox', { name: 'Message WordPress Studio' } )
			).toHaveLength( 1 );
			expect( input ).toHaveValue( 'Keep this draft' );
			if ( thumbnail ) {
				expect( screen.getAllByAltText( 'Saved site preview' ) ).toHaveLength( 2 );
				expect( chatThumbnail ).toBeVisible();
				expect( panel ).not.toContainElement( chatThumbnail );
			}
			fireEvent.click( start );
			await waitFor( () => expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'one' ) );
			expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
			expect( input ).toHaveValue( 'Keep this draft' );
		}
	);

	it.each( [ false, true ] )(
		'remembers the preview visibility after reloading (open: %s)',
		async ( open ) => {
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
			const initial = {
				signedIn: true,
				path: '/sites/one/new',
				sites: [ site( { running: true } ) ],
			};
			const { unmount } = setup( initial );
			await findComposer();
			fireEvent.click( screen.getByRole( 'button', { name: 'Show preview' } ) );
			const hide = await screen.findByRole( 'button', { name: 'Hide preview' } );
			if ( ! open ) fireEvent.click( hide );
			await screen.findByRole( 'button', { name: open ? 'Hide preview' : 'Show preview' } );
			unmount();
			const { connector } = setup( initial );
			await findComposer();
			expect(
				await screen.findByRole( 'button', { name: open ? 'Hide preview' : 'Show preview' } )
			).toHaveAttribute( 'aria-expanded', String( open ) );
			expect( connector.startSite ).not.toHaveBeenCalled();
		}
	);

	it.each(
		[ undefined, true, false ].flatMap( ( openChatOnSiteStart ) =>
			[ 'header', 'palette', 'app menu' ].flatMap( ( control ) =>
				[ '/sites/one', '/sites/one/new' ].map( ( path ) => ( {
					openChatOnSiteStart,
					control,
					path,
				} ) )
			)
		)
	)(
		'manually toggles a stopped preview beside chat from $control at $path (start chat: $openChatOnSiteStart)',
		async ( { openChatOnSiteStart, control, path } ) => {
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
			localStorage.setItem( SITE_CHAT_HIDDEN_STORAGE_KEY, JSON.stringify( { one: true } ) );
			const { connector } = setup( {
				signedIn: true,
				path,
				preferences: { openChatOnSiteStart } as FakeConnectorState[ 'preferences' ],
			} );
			await screen.findByRole( 'button', { name: 'Site menu' } );
			const toggle = async ( label: string ) => {
				if ( control === 'header' )
					fireEvent.click( screen.getByRole( 'button', { name: label } ) );
				else if ( control === 'palette' ) await paletteCommand( label );
				else await act( () => connector.emit( 'onToggleSitePreview' ) );
			};
			if ( path === '/sites/one' ) await toggle( 'Hide preview' );
			const input = await findComposer();
			fireEvent.change( input, { target: { value: 'Keep this draft' } } );
			for ( const open of [ true, false, true ] ) {
				await toggle( open ? 'Show preview' : 'Hide preview' );
				await waitFor( () => {
					expect( !! screen.queryByRole( 'complementary', { name: 'Site preview' } ) ).toBe( open );
					expect( input ).toBeVisible();
					expect( input.closest( '[aria-hidden="true"]' ) ).toBeNull();
				} );
				expect( composer() ).toBe( input );
				expect( input ).toHaveValue( 'Keep this draft' );
			}
			expect( connector.startSite ).not.toHaveBeenCalled();
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it( 'shows startup animation only in the preview when chat is beside it', async () => {
		localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
		const { connector } = setup( { signedIn: true } );
		let finishStart!: () => void;
		connector.startSite.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finishStart = () => {
						connector.state.sites = [ site( { running: true } ) ];
						resolve();
					};
				} )
		);
		await findComposer();
		fireEvent.click( screen.getByRole( 'button', { name: 'Show preview' } ) );
		const panel = await screen.findByRole( 'complementary', { name: 'Site preview' } );
		fireEvent.click( within( panel ).getByRole( 'button', { name: 'Start site' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
		await screen.findByText( 'Loading site preview' );
		const logos = document.querySelectorAll( 'canvas ~ span[aria-hidden="true"]' );
		expect( logos ).toHaveLength( 1 );
		expect( panel ).toContainElement( logos[ 0 ] as HTMLElement );
		await act( async () => finishStart() );
	} );

	it( 'expands and restores the preview from its own toolbar without replacing the chat', async () => {
		const { connector } = setup( { signedIn: true, sites: [ site( { running: true } ) ] } );
		const input = await findComposer();
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		const toolbar = await screen.findByRole( 'toolbar', { name: 'Preview browser controls' } );
		const expand = within( toolbar ).getByRole( 'button', { name: 'Enter fullscreen' } );
		expect( document.querySelector( '[data-site-header-actions]' ) ).not.toContainElement( expand );
		const frame = document.querySelector( 'iframe' );
		const publish = screen.getByRole( 'button', { name: 'Publish…' } );
		fireEvent.click( expand );
		await waitForFullscreen( true );
		expect( within( toolbar ).getByRole( 'button', { name: 'Exit fullscreen' } ) ).toBe( expand );
		fireEvent.click( expand );
		await waitForFullscreen( false );
		expect( composer() ).toBe( input );
		expect( input ).toHaveValue( 'Keep this draft' );
		expect( document.querySelector( 'iframe' ) ).toBe( frame );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
		expect( connector.startSite ).not.toHaveBeenCalled();
		expect( connector.stopSite ).not.toHaveBeenCalled();
	} );

	it( 'returns from a full-width site preview to chat using its toolbar', async () => {
		const { history } = setup( {
			signedIn: true,
			sites: [ site( { running: true } ) ],
			path: '/sites/one',
		} );
		const collapse = await screen.findByRole( 'button', { name: 'Exit fullscreen' } );
		const frame = document.querySelector( 'iframe' );
		fireEvent.click( collapse );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		expect( await findComposer() ).toBeVisible();
		expect( await screen.findByRole( 'button', { name: 'Enter fullscreen' } ) ).toBeVisible();
		expect( document.querySelector( 'iframe' ) ).toBe( frame );
	} );

	it( 'preserves the header, draft, and preview through fullscreen commands', async () => {
		setup( { signedIn: true, sites: [ site( { running: true } ) ] } );
		const input = await findComposer();
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		const toggle = await screen.findByRole( 'button', { name: 'Hide preview' } );
		const publish = screen.getByRole( 'button', { name: 'Publish…' } );
		const frame = document.querySelector( 'iframe' );
		await setChatFullscreen( true );
		await waitForFullscreen( true );
		expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toBe( toggle );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
		await setChatFullscreen( false );
		await waitForFullscreen( false );
		expect( input ).toHaveValue( 'Keep this draft' );
		expect( document.querySelector( 'iframe' ) ).toBe( frame );
	} );

	it.each( [ false, true ] )(
		'toggles the preview from its persistent header control and preserves the chat (fullscreen: %s)',
		async ( fullscreen ) => {
			const { connector } = setup( {
				signedIn: true,
				sites: [ site( { running: true } ) ],
				sessions: [ chat( { id: 'close-preview', title: 'Existing chat' } ) ],
				path: '/sessions/close-preview',
			} );
			const input = await findComposer();
			await waitFor( () => expect( input ).toBeEnabled() );
			fireEvent.change( input, { target: { value: 'Keep this unsent idea' } } );
			await waitForFullscreen( false );
			const frame = document.querySelector( 'iframe' );
			if ( fullscreen ) {
				await setChatFullscreen( true );
			}
			const toggle = screen.getByRole( 'button', { name: 'Hide preview' } );
			const delivery = document.querySelector< HTMLElement >( '[data-site-header-delivery]' )!;
			const publish = within( delivery ).getByRole( 'button', { name: 'Publish…', hidden: true } );
			expect( toggle ).toHaveAttribute( 'aria-expanded', 'true' );
			toggle.focus();
			fireEvent.click( toggle );
			await waitFor( () =>
				expect(
					screen.queryByRole( 'complementary', { name: 'Site preview' } )
				).not.toBeInTheDocument()
			);
			expect( input ).toBeVisible();
			expect( input ).toHaveValue( 'Keep this unsent idea' );
			expect( screen.queryByRole( 'button', { name: 'Hide preview' } ) ).not.toBeInTheDocument();
			expect( screen.getByRole( 'button', { name: 'Show preview' } ) ).toBe( toggle );
			expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
			expect( toggle ).toHaveFocus();
			expect( delivery ).toBeVisible();
			expect( within( delivery ).getByRole( 'button', { name: 'Publish…' } ) ).toBe( publish );
			expect( connector.stopSite ).not.toHaveBeenCalled();
			fireEvent.click( toggle );
			expect( await screen.findByRole( 'button', { name: 'Hide preview' } ) ).toBe( toggle );
			expect( toggle ).toHaveAttribute( 'aria-expanded', 'true' );
			expect( delivery ).toBeVisible();
			expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toBeVisible();
			await waitForFullscreen( fullscreen );
			expect(
				screen.getByRole( 'combobox', { name: 'Message WordPress Studio', hidden: true } )
			).toBe( input );
			expect( document.querySelector( 'iframe' ) ).toBe( frame );
		}
	);

	it.each( [ 'header', 'palette', 'app menu' ] )(
		'opens and closes the preview full width from the %s on a narrow screen',
		async ( control ) => {
			const matchMedia = window.matchMedia.bind( window );
			const media = vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query ) => ( {
				...matchMedia( query ),
				matches: query === '(max-width: 540px)' || matchMedia( query ).matches,
			} ) );
			try {
				const { connector } = setup( { signedIn: true, sites: [ site( { running: true } ) ] } );
				const input = await findComposer();
				const toggle = await screen.findByRole( 'button', { name: 'Show preview' } );
				const run = async ( label: string ) => {
					if ( control === 'header' ) fireEvent.click( toggle );
					else if ( control === 'palette' ) await paletteCommand( label );
					else await act( () => connector.emit( 'onToggleSitePreview' ) );
				};
				await run( 'Show preview' );
				await waitFor( () => expect( input.closest( '[aria-hidden="true"]' ) ).not.toBeNull() );
				expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toBe( toggle );
				await run( 'Hide preview' );
				await waitFor( () => expect( input.closest( '[aria-hidden="true"]' ) ).toBeNull() );
				expect( screen.getByRole( 'button', { name: 'Show preview' } ) ).toBe( toggle );
			} finally {
				media.mockRestore();
			}
		}
	);

	it.each( [ 'header', 'palette', 'app menu' ] )(
		'opens a full-width chat when closing the preview from a site page using the %s',
		async ( control ) => {
			const { history, connector } = setup( {
				signedIn: true,
				sites: [ site( { running: true } ) ],
				path: '/sites/one',
			} );
			const toggle = await screen.findByRole( 'button', { name: 'Hide preview' } );
			if ( control === 'header' ) fireEvent.click( toggle );
			else if ( control === 'palette' ) await paletteCommand( 'Hide preview' );
			else await act( () => connector.emit( 'onToggleSitePreview' ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
			expect( await findComposer() ).toBeVisible();
			expect( screen.queryByRole( 'button', { name: 'Hide preview' } ) ).not.toBeInTheDocument();
			expect( screen.getByRole( 'button', { name: 'Show preview' } ) ).toBeVisible();
			expect( connector.stopSite ).not.toHaveBeenCalled();
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it.each( [ false, true ] )(
		'restores the last conversation and visibility when selecting its site (hidden: %s)',
		async ( hidden ) => {
			const { history } = setup( {
				signedIn: true,
				path: '/sessions/remembered',
				sites: [
					site( { running: true } ),
					site( { id: 'two', name: 'Second site', path: '/sites/two', running: true } ),
				],
				sessions: [
					chat( { id: 'remembered', title: 'Remembered chat' } ),
					chat( {
						id: 'other',
						title: 'Other chat',
						ownerSiteId: 'two',
						ownerSitePath: '/sites/two',
					} ),
				],
			} );
			await waitForFullscreen( false );
			if ( hidden ) await setChatFullscreen( true );
			await act( () => history.push( '/sessions/other' ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/other' ) );
			fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/remembered' ) );
			await waitForFullscreen( hidden );
		}
	);

	it( 'returns to a new-chat draft instead of an older conversation', async () => {
		const { history } = setup( {
			signedIn: true,
			path: '/sites/one/new',
			sites: [
				site( { running: true } ),
				site( { id: 'two', name: 'Second site', path: '/sites/two', running: true } ),
			],
			sessions: [ chat( { id: 'older', title: 'Older chat' } ) ],
		} );
		const input = await findComposer();
		await waitFor( () => expect( input ).toBeEnabled() );
		fireEvent.change( input, { target: { value: 'Unsent draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Second site' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		expect( await findComposer() ).toHaveValue( 'Unsent draft' );
	} );

	it( 'shares chat visibility across running sites and reloads', async () => {
		const initial = {
			signedIn: true,
			path: '/sites/one/new',
			sites: [
				site( { running: true } ),
				site( { id: 'two', name: 'Second site', path: '/sites/two', running: true } ),
			],
		};
		const { unmount } = setup( initial );
		await setChatFullscreen( true );
		fireEvent.click( screen.getByRole( 'button', { name: 'Second site' } ) );
		await waitForFullscreen( true );
		fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
		await waitForFullscreen( true );
		unmount();

		setup( initial );
		await waitForFullscreen( true );
	} );

	it.each( [ 'closed', 'split', 'fullscreen' ] as const )(
		'reveals running sites and preserves the %s layout when selecting stopped sites',
		async ( mode ) => {
			const initial = {
				signedIn: true,
				path: '/sites/one/new',
				sites: [
					site( { running: true } ),
					site( { id: 'two', name: 'Second site', path: '/sites/two', running: true } ),
					site( { id: 'three', name: 'Stopped site', path: '/sites/three' } ),
				],
			};
			const { connector, unmount, history } = setup( initial );
			await waitForFullscreen( false );
			if ( mode === 'closed' )
				fireEvent.click( screen.getByRole( 'button', { name: 'Hide preview' } ) );
			if ( mode === 'fullscreen' ) await setChatFullscreen( true );
			const assertLayout = async ( open = true ) => {
				if ( ! open ) {
					await screen.findByRole( 'button', { name: 'Show preview' } );
					expect( await findComposer() ).toBeVisible();
					expect(
						screen.queryByRole( 'complementary', { name: 'Site preview' } )
					).not.toBeInTheDocument();
				} else await waitForFullscreen( mode === 'fullscreen' );
			};
			await assertLayout( mode !== 'closed' );
			fireEvent.click( screen.getByRole( 'button', { name: 'Second site' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
			await assertLayout();
			fireEvent.click( screen.getByRole( 'button', { name: 'Stopped site' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/three/new' ) );
			await assertLayout();
			fireEvent.click( screen.getByRole( 'button', { name: 'Second site' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
			fireEvent.click( screen.getByRole( 'button', { name: 'Hide preview' } ) );
			await assertLayout( false );
			fireEvent.click( screen.getByRole( 'button', { name: 'Stopped site' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/three/new' ) );
			await assertLayout( false );
			fireEvent.click( screen.getByRole( 'button', { name: 'My site' } ) );
			await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
			await assertLayout();
			expect( connector.startSite ).not.toHaveBeenCalled();
			unmount();
			setup( initial );
			await assertLayout();
		}
	);

	it.each( [ 'sidebar', 'command palette' ] )(
		'reveals a saved hidden chat from the %s',
		async ( source ) => {
			localStorage.setItem(
				PREVIEW_LAYOUT_STORAGE_KEY,
				JSON.stringify( { open: true, chatHidden: true } )
			);
			setup( {
				signedIn: true,
				path: '/sites/one/new',
				sites: [ site( { running: true } ) ],
				sessions: [ chat( { id: 'remembered', title: 'Remembered chat' } ) ],
			} );
			await waitForFullscreen( true );
			if ( source === 'sidebar' ) {
				fireEvent.click(
					await within( screen.getByRole( 'group', { name: 'Sites' } ) ).findByRole( 'button', {
						name: 'Remembered chat',
					} )
				);
			} else {
				await paletteCommand( 'Remembered chat' );
			}
			await waitFor( () =>
				expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toBeVisible()
			);
		}
	);

	it( 'reveals a saved hidden chat when resetting the interface', async () => {
		localStorage.setItem(
			PREVIEW_LAYOUT_STORAGE_KEY,
			JSON.stringify( { open: true, chatHidden: true } )
		);
		setup( { signedIn: true, path: '/sites/one/new', sites: [ site( { running: true } ) ] } );
		await waitForFullscreen( true );
		fireEvent.click( screen.getByRole( 'button', { name: 'Settings' } ) );
		const settings = await screen.findByRole( 'dialog', { name: 'Settings' } );
		fireEvent.click( within( settings ).getByRole( 'button', { name: 'Reset interface' } ) );
		await waitFor( () =>
			expect( localStorage.getItem( SITE_CHAT_HIDDEN_STORAGE_KEY ) ).toBeNull()
		);
		fireEvent.click( within( settings ).getByRole( 'button', { name: 'Close settings' } ) );
		expect( await waitForFullscreen( false ) ).toBeVisible();
	} );

	it( 'opens a hidden draft and toggles it from the sidebar beside a running preview', async () => {
		const { connector, history } = setup( {
			signedIn: true,
			sites: [ site( { running: true } ) ],
		} );
		await findComposer();
		await setChatFullscreen( true );
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
		fireEvent.change( composer(), { target: { value: 'Keep this draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
		await waitFor( () =>
			expect(
				screen
					.getByRole( 'combobox', { name: 'Message WordPress Studio', hidden: true } )
					.closest( '[aria-hidden="true"]' )
			).not.toBeNull()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'New chat for My site' } ) );
		await waitFor( () => expect( composer().closest( '[aria-hidden="true"]' ) ).toBeNull() );
		expect( composer() ).toHaveValue( 'Keep this draft' );
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
		await setChatFullscreen( true );
		await waitForFullscreen( true );
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

	it( 'keeps Annotate in its fixed group after starting from the composer', async () => {
		const { connector } = setup( {
			signedIn: true,
			overrides: {
				capabilities: { nativeFolderPicker: true, annotatePreview: true, studioLogs: true },
			},
		} );
		await findComposer();
		expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
		fireEvent.click( composerStartButton() );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		const annotate = await screen.findByRole( 'button', { name: 'Annotate' } );
		expect( document.querySelector( '[data-site-header-actions]' ) ).toContainElement( annotate );
		expect( document.querySelector( '[data-site-header-delivery]' ) ).toContainElement( annotate );
	} );

	it( 'starts from the composer and stops through the site menu without a sidebar start button', async () => {
		localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
		const { connector, history, refreshSessions } = setup( { signedIn: true } );
		await findComposer();
		for ( const name of [ 'Address', 'Back', 'Forward', 'Reload preview' ] ) {
			expect( screen.queryByRole( 'button', { name } ) ).not.toBeInTheDocument();
		}
		expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
		expect(
			within( screen.getByRole( 'complementary' ) ).queryByRole( 'button', { name: 'Start site' } )
		).not.toBeInTheDocument();
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
		expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBeVisible();
		fireEvent.click(
			within( screen.getByRole( 'complementary' ) ).getByRole( 'button', { name: 'Hide sidebar' } )
		);
		expect(
			within( document.querySelector< HTMLElement >( '[data-site-header-actions]' )! ).queryByRole(
				'button',
				{ name: 'Start site' }
			)
		).not.toBeInTheDocument();
		fireEvent.click( composerStartButton() );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( 'one' ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Hide preview' } ) ).toBeVisible()
		);
		expect( await screen.findByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Stop site' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Stop site' } ) );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'one' ) );
		expect( await screen.findByRole( 'button', { name: 'Start My site' } ) ).toBeVisible();
	} );

	it.each( [ 'split', 'fullscreen', 'site' ] )(
		'keeps the preview open after stopping from the %s layout',
		async ( layout ) => {
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'true' );
			localStorage.setItem(
				PREVIEW_LAYOUT_STORAGE_KEY,
				JSON.stringify( { open: true, chatHidden: layout !== 'split' } )
			);
			const { connector, history } = setup( {
				signedIn: true,
				path: layout === 'site' ? '/sites/one' : '/sites/one/new',
				sites: [ site( { running: true } ) ],
			} );
			await screen.findByRole( 'button', { name: 'Hide preview' } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Stop My site' } ) );
			await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'one' ) );
			expect( await screen.findByRole( 'button', { name: 'Hide preview' } ) ).toBeVisible();
			await waitForFullscreen( layout !== 'split' );
			expect( JSON.parse( localStorage.getItem( PREVIEW_LAYOUT_STORAGE_KEY )! ).open ).toBe( true );
			expect( history.location.pathname ).toBe( '/sites/one/new' );
			expect( await screen.findByRole( 'complementary', { name: 'Site preview' } ) ).toBeVisible();
			expect( connector.createSession ).not.toHaveBeenCalled();
		}
	);

	it( 'preserves draft and attachments through external start and stop events', async () => {
		localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
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
			await screen.findByRole( 'button', { name: 'Show preview' } );
			expect(
				screen.queryByRole( 'complementary', { name: 'Site preview' } )
			).not.toBeInTheDocument();
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
			localStorage.setItem( PREVIEW_OPEN_STORAGE_KEY, 'false' );
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
			expect( await screen.findByRole( 'button', { name: 'Show preview' } ) ).toBeVisible();
			expect( screen.queryByRole( 'textbox', { name: 'Address' } ) ).not.toBeInTheDocument();
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
