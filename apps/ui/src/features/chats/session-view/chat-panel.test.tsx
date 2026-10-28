import { ADD_PAYMENT_METHOD_URL } from '@studio/common/lib/studio-assistant-quota';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelChangeEntry } from '@/data/queries/use-sessions';
import {
	changeAnnotation,
	getSiteAnnotations,
	pickAnnotation,
	removeAnnotations,
	requestAnnotationSend,
} from '@/features/annotations';
import { createFakeConnector, makeSession, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AgentRunEvent, SessionEntry } from '@/data/core';
import type { AiSettings } from '@studio/common/ai/providers';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

vi.setConfig( { testTimeout: 30_000 } );

const SITE_ID = 'notice-site';

async function setupChat( {
	provider = 'wpcom',
	quota = {},
	quotaError = false,
	settingsError = false,
	hasAnthropicApiKey = true,
	signedIn = true,
	pinnedProvider,
	entries = [],
	firstPrompt = 'Hello',
	running = false,
}: {
	provider?: 'wpcom' | 'anthropic-api-key';
	quota?: Partial< StudioAssistantQuota >;
	quotaError?: boolean;
	settingsError?: boolean;
	hasAnthropicApiKey?: boolean;
	signedIn?: boolean;
	pinnedProvider?: 'wpcom' | 'anthropic-api-key';
	entries?: SessionEntry[];
	firstPrompt?: string;
	running?: boolean;
} = {} ) {
	const site = makeSite( { id: SITE_ID, name: 'Example', running } );
	const context = pinnedProvider
		? [
				{
					type: 'custom',
					id: 'provider-context',
					customType: 'studio.session_context',
					data: { provider: pinnedProvider },
				} as SessionEntry,
		  ]
		: [];
	const connected = { hasAnthropicApiKey, provider };
	const connector = createFakeConnector(
		{
			sites: [ site ],
			user: signedIn ? TEST_USER : null,
			sessions: [
				{
					summary: makeSession( { id: 'chat', ownerSiteId: SITE_ID, firstPrompt } ),
					entries: [ ...context, ...entries ],
				},
			],
		},
		{
			getAiSettings: async () => {
				if ( settingsError ) {
					throw new Error( 'Connections unavailable' );
				}
				return { ...connected, anthropicApiKeyPreview: null };
			},
			getStudioAssistantQuota: async () => {
				if ( quotaError ) {
					throw new Error( 'Usage unavailable' );
				}
				return {
					costUsage: 0,
					costCap: 100,
					allowanceRemaining: 100,
					purchasedRemaining: 0,
					hasPaymentMethod: true,
					...quota,
				} as StudioAssistantQuota;
			},
		}
	);
	connector.getConnectedWpcomSites.mockResolvedValue( [
		{ id: 42, localSiteId: SITE_ID, name: 'Hosted example', url: 'https://example.com' },
	] as never );
	connector.setSessionEnvironment.mockImplementation( async ( id, environment ) => {
		const loaded = connector.state.sessions.find( ( entry ) => entry.summary.id === id )!;
		loaded.summary = {
			...loaded.summary,
			activeEnvironment: environment,
			lastSelectedWpcomSiteId: 42,
		};
	} );
	const view = renderApp( { connector, path: '/sessions/chat' } );
	await waitFor( () => expect( connector.getAiSettings ).toHaveBeenCalled() );
	if ( signedIn ) {
		await waitFor( () => expect( connector.getStudioAssistantQuota ).toHaveBeenCalled() );
	}
	await waitFor( () => expect( view.queryClient.isFetching() ).toBe( 0 ) );
	const input = ( await screen.findByRole( 'combobox', {
		name: 'Message WordPress Studio',
	} ) ) as HTMLTextAreaElement;
	return {
		...view,
		connector,
		input,
	};
}

const notice = () => screen.findByRole( 'alert' );
const sendButton = () => screen.getByRole( 'button', { name: 'Send message' } );
const COMPOSER = { name: 'Message WordPress Studio' };

function anthropicRow( dialog: HTMLElement ) {
	return within(
		within( dialog ).getByText( 'Anthropic', { exact: true } ).closest( '[data-settings-row]' )!
	);
}

describe( 'Composer access notices', () => {
	beforeEach( () => localStorage.clear() );

	it.each( [ 'wpcom', 'anthropic-api-key' ] as const )(
		'hides the notice when %s can send, even if an unused provider has an error',
		async ( provider ) => {
			const { input } = await setupChat( {
				provider,
				quotaError: provider === 'anthropic-api-key',
			} );
			expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
			fireEvent.change( input, { target: { value: 'Keep this draft' } } );
			expect( sendButton() ).toBeEnabled();
		}
	);

	it.each( [
		{ settingsError: true, message: 'Couldn’t load your AI provider.' },
		{ quotaError: true, message: 'AI usage is currently unavailable.' },
	] )( 'retries $message without submitting or clearing the draft', async ( options ) => {
		const { connector, input } = await setupChat( options );
		const alert = await notice();
		expect( alert ).toHaveTextContent( options.message );
		expect( within( alert ).getAllByRole( 'button' ) ).toHaveLength( 1 );
		fireEvent.change( input, { target: { value: 'Preserve this draft' } } );
		const calls = connector.getAiSettings.mock.calls.length;
		fireEvent.click( within( alert ).getByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () =>
			expect( connector.getAiSettings.mock.calls.length ).toBeGreaterThan( calls )
		);
		expect( input ).toHaveValue( 'Preserve this draft' );
		expect( connector.continueSession ).not.toHaveBeenCalled();
	} );

	it( 'pairs the payment notice with only Set up', async () => {
		const { connector } = await setupChat( {
			quota: { hasPaymentMethod: false, allowanceRemaining: 0 },
		} );
		const alert = await notice();
		expect( alert ).not.toHaveTextContent( /beta/i );
		const action = within( alert ).getByRole( 'button', { name: 'Set up' } );
		expect( within( alert ).getAllByRole( 'button' ) ).toHaveLength( 1 );
		expect(
			within( alert ).queryByRole( 'button', { name: 'Add credits' } )
		).not.toBeInTheDocument();
		fireEvent.click( action );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( ADD_PAYMENT_METHOD_URL );
	} );

	it( 'offers another provider when WordPress.com AI access is blocked', async () => {
		const { connector, history } = await setupChat( {
			quota: {
				studioCodeAiHasAccess: false,
				studioCodeAiAccess: 'blocked',
				hasPaymentMethod: false,
			},
		} );
		const alert = await notice();
		expect( alert ).toHaveTextContent( 'Connect a different provider to continue this chat.' );
		expect( within( alert ).getAllByRole( 'button' ) ).toHaveLength( 1 );
		fireEvent.click( within( alert ).getByRole( 'button', { name: 'Connect' } ) );
		await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	} );

	it( 'does not show a monthly-reset notice for the retired quota-only response', async () => {
		const { input } = await setupChat( {
			quota: {
				costUsage: 100,
				costCap: 100,
				allowanceRemaining: undefined,
				purchasedRemaining: undefined,
			},
		} );
		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		expect( sendButton() ).toBeEnabled();
	} );

	it( 'opens credit purchase and rechecks usage when returning to Studio', async () => {
		const { connector } = await setupChat( { quota: { allowanceRemaining: 0 } } );
		const alert = await notice();
		expect( alert ).toHaveTextContent( 'Add AI credits to send another message.' );
		expect( within( alert ).getAllByRole( 'button' ) ).toHaveLength( 1 );
		fireEvent.click( within( alert ).getByRole( 'button', { name: 'Add credits' } ) );
		await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalled() );
		const calls = connector.getStudioAssistantQuota.mock.calls.length;
		fireEvent( window, new Event( 'visibilitychange' ) );
		await waitFor( () =>
			expect( connector.getStudioAssistantQuota.mock.calls.length ).toBeGreaterThan( calls )
		);
	} );

	it( 'shows only the offline notice when account actions are also unavailable', async () => {
		await setupChat( { quota: { allowanceRemaining: 0 } } );
		const online = vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		try {
			act( () => {
				fireEvent( window, new Event( 'offline' ) );
			} );
			const alert = await screen.findByText( 'You are offline. Reconnect to send a message.' );
			expect(
				within( alert.closest( '[role="alert"]' )! ).queryByRole( 'button' )
			).not.toBeInTheDocument();
		} finally {
			online.mockRestore();
			act( () => {
				fireEvent( window, new Event( 'online' ) );
			} );
		}
	} );

	it.each( [
		{ provider: 'wpcom' as const, payment: false, gated: true },
		{ provider: 'wpcom' as const, payment: null, gated: false },
		{ provider: 'anthropic-api-key' as const, payment: false, gated: false },
	] )(
		'checks payment access for $provider with payment=$payment',
		async ( { provider, payment, gated } ) => {
			const quota =
				payment === null
					? null
					: {
							costUsage: 0,
							costCap: 500000,
							costResetDate: '',
							emailVerified: true,
							hasPaymentMethod: payment,
							studioCodeAiHasAccess: true,
							studioCodeAiAccess: 'granted' as const,
							allowanceRemaining: 100,
							purchasedRemaining: 0,
							purchasedAtTopUp: 0,
					  };
			const connector = createFakeConnector(
				{ sites: [ makeSite( { id: 'one', path: '/sites/my-site' } ) ] },
				{
					getAiSettings: async () => ( {
						provider,
						hasAnthropicApiKey: true,
						anthropicApiKeyPreview: 'test',
					} ),
					getStudioAssistantQuota: async () => quota,
				}
			);
			renderApp( { connector, path: '/sites/one/new' } );
			await screen.findByRole( 'button', { name: 'Site actions for My site' } );
			const input = await screen.findByRole( 'combobox', COMPOSER );
			if ( gated ) {
				const addPayment = await screen.findByRole( 'button', { name: 'Set up' } );
				expect( input ).toBeEnabled();
				expect( sendButton() ).toBeDisabled();
				fireEvent.click( addPayment );
				expect( connector.openExternalUrl ).toHaveBeenCalledWith( ADD_PAYMENT_METHOD_URL );
				expect( connector.continueSession ).not.toHaveBeenCalled();
				connector.getStudioAssistantQuota.mockResolvedValue( {
					...quota!,
					hasPaymentMethod: true,
				} );
				fireEvent.focus( window, { relatedTarget: input } );
			}
			await waitFor( () => expect( input ).toBeEnabled() );
			await waitFor( () =>
				expect( screen.queryByRole( 'button', { name: 'Set up' } ) ).not.toBeInTheDocument()
			);
		}
	);

	it.each( [ false, true ] )(
		'connects a personal key without WordPress.com login (saved=%s)',
		async ( saved ) => {
			let connection: AiSettings = {
				provider: 'wpcom',
				hasAnthropicApiKey: saved,
				anthropicApiKeyPreview: saved ? 'test' : null,
			};
			const site = makeSite( { id: 'one', path: '/sites/my-site' } );
			const connector = createFakeConnector(
				{
					user: null,
					sites: [ site ],
					sessions: [
						{
							summary: makeSession( {
								id: 'key-chat',
								ownerSiteId: 'one',
								ownerSitePath: site.path,
							} ),
							entries: [],
						},
					],
				},
				{
					getAiSettings: async () => connection,
					saveAnthropicApiKey: async () => {
						connection = {
							...connection,
							hasAnthropicApiKey: true,
							anthropicApiKeyPreview: 'test',
						};
						return connection;
					},
					setAiProvider: async ( provider ) => {
						connection = { ...connection, provider };
						return connection;
					},
					continueSession: async () => ( { runId: 'key-run' } ),
				}
			);
			renderApp( { connector, path: '/sessions/key-chat' } );
			await screen.findByRole( 'button', { name: 'Site actions for My site' } );
			const draftInput = await screen.findByRole( 'combobox', COMPOSER );
			fireEvent.change( draftInput, { target: { value: 'Update my site' } } );
			await screen.findByRole( 'button', { name: 'Connect' } );
			expect( draftInput ).toBeEnabled();
			expect( sendButton() ).toBeEnabled();
			fireEvent.click( sendButton() );
			expect( draftInput ).toHaveValue( 'Update my site' );
			expect( connector.createSession ).not.toHaveBeenCalled();
			expect( connector.continueSession ).not.toHaveBeenCalled();
			expect( screen.queryByText( 'Checking access…' ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'button', { name: 'Check again' } ) ).not.toBeInTheDocument();
			fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );
			const dialog = await screen.findByRole( 'dialog', { name: 'Settings' } );
			fireEvent.click(
				anthropicRow( dialog ).getByRole( 'button', { name: saved ? 'Manage' : 'Connect' } )
			);
			if ( ! saved ) {
				const keyInput = await screen.findByLabelText( 'Anthropic API key', { selector: 'input' } );
				expect( keyInput ).toHaveAttribute( 'type', 'password' );
				fireEvent.change( keyInput, { target: { value: '  test-key  ' } } );
			}
			fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Save' } ) );
			await waitFor( () =>
				expect( connector.setAiProvider ).toHaveBeenCalledWith( 'anthropic-api-key' )
			);
			await waitFor( () =>
				expect( anthropicRow( dialog ).getByRole( 'button', { name: 'Manage' } ) ).toBeEnabled()
			);
			fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Close settings' } ) );
			await waitFor( () => expect( sendButton() ).toBeEnabled() );
			const input = screen.getByRole( 'combobox', COMPOSER );
			expect( input ).toHaveValue( 'Update my site' );
			expect( connector.authenticate ).not.toHaveBeenCalled();
			fireEvent.click( sendButton() );
			await waitFor( () =>
				expect( connector.continueSession ).toHaveBeenCalledWith(
					'key-chat',
					'Update my site',
					expect.anything()
				)
			);
		}
	);
} );

describe( 'Chat target selection', () => {
	it.each( [
		{ signedIn: false, hasAnthropicApiKey: false },
		{ signedIn: true, hasAnthropicApiKey: false },
		{ signedIn: false, hasAnthropicApiKey: true },
		{ signedIn: true, hasAnthropicApiKey: true },
	] )( 'only lists models for connected providers: %j', async ( connections ) => {
		const { input, history } = await setupChat( connections );
		if ( ! connections.signedIn && ! connections.hasAnthropicApiKey ) {
			expect( screen.queryByRole( 'button', { name: 'Model' } ) ).not.toBeInTheDocument();
			fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
			await screen.findByRole( 'option', { name: /^Connect AI providers/ } );
			expect( screen.queryByRole( 'option', { name: /^Choose model/ } ) ).not.toBeInTheDocument();
			fireEvent.keyDown( document.activeElement!, { key: 'Escape' } );
			fireEvent.change( input, { target: { value: '/model' } } );
			expect( screen.queryByRole( 'option', { name: /^Choose model/ } ) ).not.toBeInTheDocument();
			return;
		}
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Choose model/ } ) );
		const connect = await screen.findByRole( 'option', { name: /^Connect provider…/ } );
		for ( const name of [ 'Fast', 'Balanced', 'Strong' ] ) {
			expect( !! screen.queryByRole( 'option', { name: new RegExp( `^${ name }` ) } ) ).toBe(
				connections.signedIn
			);
		}
		for ( const name of [ 'Sonnet 5', 'Opus 5' ] ) {
			expect( !! screen.queryByRole( 'option', { name: new RegExp( `^${ name }` ) } ) ).toBe(
				connections.hasAnthropicApiKey
			);
		}
		fireEvent.click( connect );
		await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
	} );

	it( 'shows setup before sending and keeps signed-out drafts editable', async () => {
		const { connector, input, history } = await setupChat( {
			signedIn: false,
			hasAnthropicApiKey: false,
		} );
		expect( input ).toBeEnabled();
		const alert = await notice();
		expect( alert ).toHaveTextContent( 'Connect a provider to build and edit your site.' );
		expect(
			screen.queryByRole( 'button', { name: 'Connect WordPress.com' } )
		).not.toBeInTheDocument();
		fireEvent.change( input, { target: { value: 'Build a homepage' } } );
		fireEvent.click( sendButton() );
		expect( sendButton() ).toBeEnabled();
		fireEvent.keyDown( input, { key: 'Enter' } );
		await waitFor( () => expect( input ).toHaveValue( 'Build a homepage' ) );
		expect( connector.startSite ).not.toHaveBeenCalled();
		expect( connector.continueSession ).not.toHaveBeenCalled();
		fireEvent.click( within( alert ).getByRole( 'button', { name: 'Connect' } ) );
		await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
		expect( connector.authenticate ).not.toHaveBeenCalled();
	} );

	it( 'switches an empty chat to the picked model and the live site while preserving the draft', async () => {
		const { connector, input } = await setupChat( {
			provider: 'anthropic-api-key',
			signedIn: false,
			firstPrompt: '',
		} );
		connector.setSessionModel.mockImplementation( async ( id, model ) => {
			connector.state.sessions[ 0 ].entries.push( createModelChangeEntry( model ) );
		} );
		fireEvent.change( input, { target: { value: 'Preserve this draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Model' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Opus 5/ } ) );
		await waitFor( () =>
			expect( connector.setSessionModel ).toHaveBeenCalledWith( 'chat', 'claude-opus-5' )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Work on live site/ } ) );
		await waitFor( () =>
			expect( connector.setSessionEnvironment ).toHaveBeenCalledWith( 'chat', 'live' )
		);
		expect( await screen.findByRole( 'button', { name: 'Remove Live' } ) ).toBeVisible();
		expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toHaveValue(
			'Preserve this draft'
		);
		expect( screen.getByRole( 'button', { name: 'Model' } ) ).toHaveAttribute(
			'aria-description',
			'Opus 5 · Anthropic API'
		);
	} );
} );

describe( 'Chat pane context menu', () => {
	it.each( [
		{
			name: 'single-choice questionnaire',
			entry: {
				type: 'custom',
				customType: 'studio.agent_question',
				data: { question: 'Which layout?', options: [ { label: 'Grid' } ] },
			},
		},
		{
			name: 'multiple-choice questionnaire',
			entry: {
				type: 'custom',
				customType: 'studio.agent_question',
				data: { question: 'Which layout?', multiSelect: true, options: [ { label: 'Grid' } ] },
			},
		},
		{
			name: 'tool call',
			entry: {
				type: 'message',
				message: {
					role: 'assistant',
					content: [ { type: 'toolCall', id: 'tool', name: 'read', arguments: {} } ],
				},
			},
		},
		{
			name: 'status marker',
			entry: {
				type: 'custom',
				customType: 'studio.turn_closed',
				data: { status: 'interrupted' },
			},
		},
	] )( 'does not open chat actions on a $name or its contents', async ( { entry } ) => {
		await setupChat( {
			pinnedProvider: 'wpcom',
			entries: [ { id: 'entry', ...entry } as SessionEntry ],
		} );
		const transcript = document.querySelector( '[data-chat-transcript]' )!;
		const item = transcript.firstElementChild!.firstElementChild!;
		expect( item ).toBeInTheDocument();
		for ( const target of [ item, ...item.querySelectorAll( '*' ) ] ) {
			const event = new MouseEvent( 'contextmenu', { bubbles: true, cancelable: true } );
			fireEvent( target, event );
			expect( event.defaultPrevented ).toBe( false );
			expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
		}
	} );

	it.each( [ 'user', 'assistant' ] as const )(
		'preserves the native context menu on %s messages and their actions',
		async ( role ) => {
			const text = 'A message to right-click';
			const entry =
				role === 'user'
					? {
							type: 'custom',
							id: 'message',
							customType: 'studio.user_prompt',
							data: { text, source: 'prompt' },
					  }
					: {
							type: 'message',
							id: 'message',
							message: { role, content: [ { type: 'text', text } ] },
					  };
			await setupChat( { pinnedProvider: 'wpcom', entries: [ entry as SessionEntry ] } );
			for ( const target of [
				await screen.findByText( text ),
				screen.getByRole( 'button', { name: 'Copy message' } ),
			] ) {
				const event = new MouseEvent( 'contextmenu', { bubbles: true, cancelable: true } );
				fireEvent( target, event );
				expect( event.defaultPrevented ).toBe( false );
				expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
			}
		}
	);

	it( 'keeps the active chat rename shortcut available without a header menu', async () => {
		await setupChat( { pinnedProvider: 'wpcom' } );
		fireEvent.keyDown( document.body, {
			code: 'KeyR',
			key: 'r',
			altKey: true,
			ctrlKey: true,
		} );
		expect( await screen.findByRole( 'dialog', { name: 'Rename chat' } ) ).toBeVisible();
	} );

	it( 'opens the shared chat actions from the body and toggles full screen', async () => {
		await setupChat( { pinnedProvider: 'wpcom', running: true } );
		const body = () => document.querySelector( '[data-chat-transcript]' )!.parentElement!;
		fireEvent.contextMenu( body() );
		expect( await screen.findByRole( 'menuitem', { name: /^Rename/ } ) ).toBeVisible();
		expect( screen.getByRole( 'menuitem', { name: /^Pin/ } ) ).toBeVisible();
		expect( screen.getByRole( 'menuitem', { name: /^Archive/ } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Full screen' } ) );
		await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
		fireEvent.contextMenu( body() );
		expect( await screen.findByRole( 'menuitem', { name: 'Exit full screen' } ) ).toBeVisible();
	} );

	it( 'has no chat actions while the chat is loading', async () => {
		const connector = createFakeConnector( {
			sites: [ makeSite( { id: SITE_ID } ) ],
			sessions: [ { summary: makeSession( { id: 'chat', ownerSiteId: SITE_ID } ), entries: [] } ],
		} );
		connector.getSession.mockReturnValue( new Promise( () => {} ) );
		renderApp( { connector, path: '/sessions/chat' } );
		await waitFor( () => expect( connector.getSession ).toHaveBeenCalled() );
		const skeleton = document.querySelector( '[inert]' )!;
		const event = new MouseEvent( 'contextmenu', { bubbles: true, cancelable: true } );
		fireEvent( skeleton, event );
		expect( event.defaultPrevented ).toBe( false );
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
	} );

	it( 'preserves the native composer context menu and its draft', async () => {
		const { input } = await setupChat( { pinnedProvider: 'wpcom' } );
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		const event = new MouseEvent( 'contextmenu', { bubbles: true, cancelable: true } );
		fireEvent( input, event );
		expect( event.defaultPrevented ).toBe( false );
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
		expect( input ).toHaveValue( 'Keep this draft' );
	} );
} );

describe( 'Chat attachment drop target', () => {
	const frame = () => document.querySelector( '[data-chat-transcript]' )!;

	it( 'attaches a file once from the chat body and keeps it inside the composer', async () => {
		const { input } = await setupChat();
		const body = frame();
		const dataTransfer = {
			types: [ 'Files' ],
			files: [ new File( [ 'notes' ], 'notes.txt', { type: 'text/plain' } ) ],
			dropEffect: 'none',
		};
		fireEvent.dragEnter( body, { dataTransfer } );
		expect( screen.getByText( 'Drop to attach' ) ).toBeInTheDocument();
		fireEvent.dragEnter( body.firstElementChild!, { dataTransfer } );
		fireEvent.dragLeave( body.firstElementChild!, { dataTransfer } );
		expect( screen.getByText( 'Drop to attach' ) ).toBeInTheDocument();
		fireEvent.drop( body, { dataTransfer } );
		expect( screen.queryByText( 'Drop to attach' ) ).not.toBeInTheDocument();
		const attachment = await screen.findByRole( 'listitem', { name: /^notes.txt,/ } );
		expect( input.closest( '[data-slot="input-group"]' ) ).toContainElement( attachment );
		expect( screen.getAllByRole( 'button', { name: 'Remove attachment' } ) ).toHaveLength( 1 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove attachment' } ) );
		expect( screen.queryByRole( 'listitem', { name: /^notes.txt,/ } ) ).not.toBeInTheDocument();
	} );

	it( 'clears feedback on exit and cancellation and ignores non-file drags', async () => {
		await setupChat();
		const body = frame();
		fireEvent.dragOver( body, { dataTransfer: { types: [ 'text/plain' ] } } );
		expect( screen.queryByText( 'Drop to attach' ) ).not.toBeInTheDocument();
		const dataTransfer = { types: [ 'Files' ], files: [], dropEffect: 'none' };
		fireEvent.dragEnter( body, { dataTransfer } );
		fireEvent.dragLeave( body, { dataTransfer } );
		expect( screen.queryByText( 'Drop to attach' ) ).not.toBeInTheDocument();
		for ( const cancel of [
			() => fireEvent.dragEnd( window ),
			() => fireEvent.keyDown( window, { key: 'Escape' } ),
			() => fireEvent.blur( window ),
			() => fireEvent.drop( window, { dataTransfer } ),
		] ) {
			fireEvent.dragEnter( body, { dataTransfer } );
			expect( screen.getByText( 'Drop to attach' ) ).toBeInTheDocument();
			act( () => {
				cancel();
			} );
			expect( screen.queryByText( 'Drop to attach' ) ).not.toBeInTheDocument();
		}
	} );
} );

describe( 'Annotation drafts during an active run', () => {
	afterEach( () =>
		removeAnnotations(
			SITE_ID,
			getSiteAnnotations( SITE_ID ).notes.map( ( note ) => note.id )
		)
	);

	function addNote() {
		const id = pickAnnotation( SITE_ID, { tag: 'h1', selector: 'h1', path: '/' } )!;
		changeAnnotation( SITE_ID, id, { comment: 'Make the heading shorter' } );
		return id;
	}

	it( 'sends a direct annotation immediately while the chat is idle', async () => {
		const { connector, input } = await setupChat( { pinnedProvider: 'wpcom' } );
		fireEvent.change( input, { target: { value: 'Keep my draft' } } );
		const id = addNote();
		act( () => requestAnnotationSend( { siteId: SITE_ID, noteIds: [ id ] } ) );
		await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
		expect( connector.continueSession.mock.calls[ 0 ][ 2 ] ).toEqual(
			expect.objectContaining( {
				visualAnnotations: expect.arrayContaining( [
					expect.objectContaining( { comment: 'Make the heading shorter' } ),
				] ),
			} )
		);
		expect( input ).toHaveValue( 'Keep my draft' );
		await waitFor( () => expect( getSiteAnnotations( SITE_ID ).notes ).toHaveLength( 0 ) );
	} );

	it.each( [ true, false ] )(
		'queues direct annotations and preserves composer saves during a run (direct: %s)',
		async ( direct ) => {
			const { connector, input } = await setupChat( { pinnedProvider: 'wpcom' } );
			fireEvent.change( input, { target: { value: 'Keep my draft' } } );
			fireEvent.click( sendButton() );
			await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledOnce() );
			const runId = ( await connector.continueSession.mock.results[ 0 ].value ).runId;
			act( () =>
				connector.emit( 'onAgentEvent', {
					sessionId: 'chat',
					runId,
					event: { type: 'run.started', timestamp: new Date().toISOString() },
				} as AgentRunEvent )
			);
			fireEvent.change( input, { target: { value: 'Keep my draft' } } );
			const id = addNote();
			act( () =>
				requestAnnotationSend( { siteId: SITE_ID, noteIds: direct ? [ id ] : undefined } )
			);
			if ( direct ) {
				expect( await screen.findByLabelText( 'Queued messages' ) ).toBeVisible();
				await waitFor( () => expect( getSiteAnnotations( SITE_ID ).notes ).toHaveLength( 0 ) );
			} else {
				expect( await screen.findByRole( 'listitem', { name: /^1 annotation,/ } ) ).toBeVisible();
				expect( screen.queryByLabelText( 'Queued messages' ) ).not.toBeInTheDocument();
			}
			expect( connector.continueSession ).toHaveBeenCalledOnce();
			expect( input ).toHaveValue( 'Keep my draft' );
			act( () =>
				connector.emit( 'onAgentEvent', {
					sessionId: 'chat',
					runId,
					event: {
						type: 'run.exited',
						timestamp: new Date().toISOString(),
						status: 'success',
						code: 0,
					},
				} as AgentRunEvent )
			);
			if ( ! direct ) {
				await waitFor( () => expect( sendButton() ).toBeEnabled() );
				fireEvent.click( sendButton() );
			}
			await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 2 ) );
			expect( connector.continueSession.mock.calls[ 1 ][ 2 ] ).toEqual(
				expect.objectContaining( {
					visualAnnotations: expect.arrayContaining( [
						expect.objectContaining( { comment: 'Make the heading shorter' } ),
					] ),
				} )
			);
		}
	);
} );
