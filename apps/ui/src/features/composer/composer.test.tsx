import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { getAiSkillCommands } from '@studio/common/ai/slash-commands';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import {
	changeAnnotation,
	getSiteAnnotations,
	pickAnnotation,
	stageAnnotations,
} from '@/features/annotations';
import { TooltipProvider } from '@/lib/ui';
import { Composer, type ComposerHandle } from './composer';
import { clearComposerDrafts } from './draft-store';
import type { AiSessionSummary, LoadedAiSession, SessionEntry } from '@/data/core';
import type { ComposerSendAttachments } from '@/data/use-composer-attachments';

// "Connect provider…" opens the settings dialog through the router.
vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => vi.fn(),
} ) );

const connectorMocks = vi.hoisted( () => ( {
	createSession: vi.fn(),
	getAiSettings: vi.fn(),
	getAuthUser: vi.fn(),
	getStudioAssistantQuota: vi.fn(),
	getUserPreferences: vi.fn(),
	setUserPreferences: vi.fn(),
	getFilePath: vi.fn( ( file: File ) => `/tmp/studio-attachments/${ file.name }` ),
	setSessionModel: vi.fn(),
	setSessionProvider: vi.fn(),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connectorMocks,
} ) );

const defaultProps = {
	busy: false,
	model: DEFAULT_MODEL,
	onSend: vi.fn< ( prompt: string, attachments?: ComposerSendAttachments ) => Promise< void > >(),
	onInterrupt: vi.fn< () => Promise< void > >(),
	entries: [],
};

function renderComposer(
	props: Partial< ComponentProps< typeof Composer > > = {},
	queryClient = new QueryClient()
) {
	const composerRef = createRef< ComposerHandle >();
	const renderTree = ( nextProps: Partial< ComponentProps< typeof Composer > > = {} ) => (
		<QueryClientProvider client={ queryClient }>
			<TooltipProvider delay={ 0 }>
				<Composer ref={ composerRef } { ...defaultProps } sessionId="session-1" { ...nextProps } />
			</TooltipProvider>
		</QueryClientProvider>
	);
	const rendered = render( renderTree( props ) );
	return {
		...rendered,
		composerRef,
		queryClient,
		rerenderComposer: ( nextProps: Partial< ComponentProps< typeof Composer > > = {} ) =>
			rendered.rerender( renderTree( nextProps ) ),
	};
}

describe( 'Composer menu', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		clearComposerDrafts();
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		connectorMocks.getAuthUser.mockResolvedValue( { id: 1, email: 'user@example.com' } );
		connectorMocks.getUserPreferences.mockResolvedValue( { autoStartSiteOnChat: false } );
		connectorMocks.setUserPreferences.mockResolvedValue( undefined );
	} );

	it( 'lists the models of every connected provider, highlighting the current one', async () => {
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		renderComposer( {
			entries: [ createSessionContextEntry( 'anthropic-api-key' ) ],
			model: 'claude-sonnet-5',
		} );

		const trigger = await screen.findByRole( 'button', { name: 'Model' } );
		await waitFor( () =>
			expect( trigger ).toHaveAccessibleDescription( 'Sonnet 5 · Anthropic API' )
		);

		fireEvent.click( trigger );
		await waitFor( () =>
			expect( getMenuLabels() ).toEqual(
				startingWith( [ 'Fast', 'Balanced', 'Strong', 'Sonnet 5', 'Opus 5', 'Connect provider' ] )
			)
		);
		expect( screen.getByRole( 'option', { name: /^Sonnet 5/ } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
	} );

	it( 'falls back to WordPress.com when a pinned conversation has no key', async () => {
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		renderComposer( { entries: [ createSessionContextEntry( 'anthropic-api-key' ) ] } );

		const trigger = await screen.findByRole( 'button', { name: 'Model' } );
		await waitFor( () =>
			expect( trigger ).toHaveAccessibleDescription( 'Fast · WordPress.com · AI usage unavailable' )
		);

		fireEvent.click( trigger );
		await waitFor( () =>
			expect( getMenuLabels() ).toEqual(
				startingWith( [ 'Fast', 'Balanced', 'Strong', 'Connect provider' ] )
			)
		);
	} );

	it( 'shows the AI credits left as a count, not a share of past top-ups', async () => {
		connectorMocks.getAuthUser.mockResolvedValue( { id: 1, email: 'user@example.com' } );
		connectorMocks.getStudioAssistantQuota.mockResolvedValue( {
			costCap: 1_000_000,
			costUsage: 0,
			studioCodeAiHasAccess: true,
			hasPaymentMethod: true,
			allowanceRemaining: 200_000,
			purchasedRemaining: 1_000_000,
			purchasedAtTopUp: 5_000_000,
		} );
		renderComposer();

		await waitFor( async () =>
			expect( await screen.findByRole( 'button', { name: 'Model' } ) ).toHaveAccessibleDescription(
				'Fast · WordPress.com · AI credits: 1.2M remaining'
			)
		);
	} );

	it( 'lists only WordPress.com models until an Anthropic API key is saved', async () => {
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		renderComposer();

		fireEvent.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await screen.findByRole( 'option', { name: /^Fast/ } );
		expect( screen.queryByRole( 'option', { name: /^Sonnet 5/ } ) ).not.toBeInTheDocument();
	} );

	it( 'hides the model picker without a provider to use', async () => {
		connectorMocks.getAuthUser.mockResolvedValue( null );
		renderComposer();

		await waitFor( () => expect( connectorMocks.getAuthUser ).toHaveBeenCalled() );
		expect( screen.queryByRole( 'button', { name: 'Model' } ) ).not.toBeInTheDocument();
	} );

	it( 'pins the conversation to the provider of the picked model', async () => {
		const queryClient = new QueryClient();
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		connectorMocks.setSessionProvider.mockResolvedValue( undefined );
		queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, 'session-1' ], {
			summary: createSummary(),
			entries: [],
		} );
		renderComposer( { model: 'balanced' }, queryClient );

		fireEvent.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Sonnet 5/ } ) );

		await waitFor( () =>
			expect( connectorMocks.setSessionProvider ).toHaveBeenCalledWith(
				'session-1',
				'anthropic-api-key',
				'claude-sonnet-5'
			)
		);
		expect(
			queryClient.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )?.entries
		).toEqual( [
			expect.objectContaining( {
				customType: 'studio.session_context',
				data: { provider: 'anthropic-api-key', model: 'claude-sonnet-5' },
			} ),
		] );
	} );

	it( 'acts as a form field: no send control, the draft read back through the ref', async () => {
		const onModelChange = vi.fn();
		const { composerRef, container } = renderComposer( {
			variant: 'field',
			model: 'balanced',
			sessionId: undefined,
			placeholder: 'Describe the site',
			onModelChange,
		} );

		expect( screen.queryByRole( 'button', { name: 'Send message' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Add' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Upload attachment' } ) ).toBeInTheDocument();
		expect( composerRef.current?.getSubmission() ).toBeNull();

		const textarea = screen.getByPlaceholderText( 'Describe the site' );
		fireEvent.change( textarea, { target: { value: 'A bright ceramics portfolio' } } );
		fireEvent.keyDown( textarea, { key: 'Enter' } );
		expect( defaultProps.onSend ).not.toHaveBeenCalled();

		const image = new File( [ 'image-bytes' ], 'moodboard.png', { type: 'image/png' } );
		fireEvent.change( container.querySelector( 'input[type="file"]' ) as HTMLInputElement, {
			target: { files: [ image ] },
		} );
		await screen.findByRole( 'listitem', { name: /^moodboard\.png/ } );
		expect( composerRef.current?.getSubmission() ).toMatchObject( {
			prompt: 'A bright ceramics portfolio',
			attachments: { images: [ expect.objectContaining( { name: 'moodboard.png' } ) ], files: [] },
		} );

		fireEvent.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Fast/ } ) );
		expect( onModelChange ).toHaveBeenCalledWith( 'fast' );
		expect( connectorMocks.setSessionModel ).not.toHaveBeenCalled();
	} );

	it( 'disables the paid tiers unless purchased credits remain', async () => {
		connectorMocks.getAuthUser.mockResolvedValue( { id: 1, email: 'user@example.com' } );
		connectorMocks.getStudioAssistantQuota.mockResolvedValue( { purchasedRemaining: 0 } );
		const { unmount } = renderComposer();

		fireEvent.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await waitFor( () => {
			expect( screen.getByRole( 'option', { name: /^Balanced/ } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			);
		} );
		expect( screen.getByRole( 'option', { name: /^Strong/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'option', { name: /^Fast/ } ) ).not.toHaveAttribute(
			'aria-disabled'
		);
		unmount();

		connectorMocks.getStudioAssistantQuota.mockResolvedValue( { purchasedRemaining: 50_000 } );
		renderComposer();

		fireEvent.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await waitFor( () => {
			expect( screen.getByRole( 'option', { name: /^Balanced/ } ) ).not.toHaveAttribute(
				'aria-disabled'
			);
		} );
	} );

	it( 'unlocks the paid tiers for Automatticians without purchased credits', async () => {
		connectorMocks.getAuthUser.mockResolvedValue( { id: 1, email: 'person@automattic.com' } );
		connectorMocks.getStudioAssistantQuota.mockResolvedValue( { purchasedRemaining: 0 } );
		renderComposer();

		fireEvent.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await waitFor( () => {
			expect( screen.getByRole( 'option', { name: /^Balanced/ } ) ).not.toHaveAttribute(
				'aria-disabled'
			);
		} );
		expect( screen.getByRole( 'option', { name: /^Strong/ } ) ).not.toHaveAttribute(
			'aria-disabled'
		);
	} );

	it( 'shows Stop while a run is busy and the draft is empty, and queues otherwise', () => {
		const onInterrupt = vi.fn< () => Promise< void > >();
		renderComposer( { busy: true, onInterrupt } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Stop response' } ) );
		expect( onInterrupt ).toHaveBeenCalledTimes( 1 );

		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'And then this' } } );
		expect( screen.getByRole( 'button', { name: 'Queue message' } ) ).toBeEnabled();
	} );

	it( 'keeps the draft until the send is accepted, clearing only what was sent', async () => {
		let acceptSend: () => void = () => {};
		const onSend = vi.fn(
			() =>
				new Promise< void >( ( resolve ) => {
					acceptSend = resolve;
				} )
		);
		renderComposer( { onSend } );
		const textarea = screen.getByRole( 'combobox' );

		fireEvent.change( textarea, { target: { value: 'First message' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( textarea ).toHaveValue( 'First message' );

		await act( async () => acceptSend() );
		expect( textarea ).toHaveValue( '' );

		fireEvent.change( textarea, { target: { value: 'Second message' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		fireEvent.change( textarea, { target: { value: 'Second message, edited meanwhile' } } );
		await act( async () => acceptSend() );
		expect( textarea ).toHaveValue( 'Second message, edited meanwhile' );
	} );

	it( 'sends staged annotations with the message once the agent is idle', async () => {
		const onSend = vi.fn().mockResolvedValue( undefined );
		const id = pickAnnotation( 'composer-site', { tag: 'h1', selector: 'h1', path: '/' } )!;
		changeAnnotation( 'composer-site', id, { comment: 'Make this bigger' } );
		stageAnnotations( 'composer-site' );
		const { rerenderComposer } = renderComposer( {
			busy: true,
			onSend,
			annotationSiteId: 'composer-site',
		} );

		expect( screen.getByRole( 'listitem', { name: /^1 annotation/ } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Stop response' } ) ).toBeVisible();

		rerenderComposer( { onSend, annotationSiteId: 'composer-site' } );
		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'Also tighten it' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );

		await waitFor( () => expect( getSiteAnnotations( 'composer-site' ).notes ).toEqual( [] ) );
		expect( onSend ).toHaveBeenCalledWith(
			expect.stringMatching( /^Also tighten it\n\nThe user submitted 1 visual annotation/ ),
			expect.objectContaining( {
				displayMessage: 'Also tighten it',
				visualAnnotations: [
					{ comment: 'Also tighten it' },
					expect.objectContaining( { comment: 'Make this bigger', tag: 'h1' } ),
				],
			} )
		);
		expect( screen.queryByRole( 'listitem', { name: /annotation/ } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the draft when the send is rejected', async () => {
		const onSend = vi.fn().mockRejectedValue( new Error( 'network error' ) );
		const firstRender = renderComposer( { onSend } );
		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'Retry this draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		firstRender.unmount();

		renderComposer();
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'Retry this draft' );
	} );

	it( 'holds sends behind the out-of-credits notice and flags a blocked send', async () => {
		connectorMocks.getStudioAssistantQuota.mockResolvedValue( {
			costCap: 100,
			studioCodeAiHasAccess: true,
			studioCodeAiAccess: 'granted',
			hasPaymentMethod: true,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
		} );
		const onSend = vi.fn< ( prompt: string ) => Promise< void > >();
		renderComposer( { onSend } );

		const notice = await screen.findByRole( 'alert' );
		expect( notice ).toHaveTextContent( 'Add AI credits to send another message.' );
		expect( within( notice ).getByRole( 'button', { name: 'Add credits' } ) ).toBeInTheDocument();

		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'One more' } } );
		fireEvent.keyDown( screen.getByRole( 'combobox' ), { key: 'Enter' } );
		expect( onSend ).not.toHaveBeenCalled();
		expect( notice ).toHaveAttribute( 'data-feedback' );
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'One more' );
	} );

	it( 'shakes the notice it is given instead of sending', async () => {
		const onConnect = vi.fn();
		const onSend = vi.fn< ( prompt: string ) => Promise< void > >();
		renderComposer( {
			onSend,
			notice: {
				message: 'Connect a provider to build and edit your site.',
				action: { label: 'Connect', onClick: onConnect },
			},
		} );

		const notice = screen.getByRole( 'alert' );
		fireEvent.click( within( notice ).getByRole( 'button', { name: 'Connect' } ) );
		expect( onConnect ).toHaveBeenCalled();

		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'Build a bakery' } } );
		fireEvent.keyDown( screen.getByRole( 'combobox' ), { key: 'Enter' } );
		expect( onSend ).not.toHaveBeenCalled();
		expect( within( notice ).getByText( /Connect a provider/ ).parentElement ).toHaveAttribute(
			'data-submit-feedback',
			'shake'
		);
	} );

	it( 'does not hold an Anthropic chat behind WordPress.com credits', async () => {
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: null,
		} );
		connectorMocks.getStudioAssistantQuota.mockResolvedValue( {
			costCap: 100,
			studioCodeAiHasAccess: true,
			hasPaymentMethod: true,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
		} );
		const onSend = vi.fn< ( prompt: string ) => Promise< void > >();
		renderComposer( {
			onSend,
			model: 'claude-sonnet-5',
			entries: [ createSessionContextEntry( 'anthropic-api-key' ) ],
		} );
		await waitFor( async () =>
			expect( await screen.findByRole( 'button', { name: 'Model' } ) ).toHaveAccessibleDescription(
				'Sonnet 5 · Anthropic API'
			)
		);

		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'One more' } } );
		fireEvent.keyDown( screen.getByRole( 'combobox' ), { key: 'Enter' } );

		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );

	it( 'inserts a skill from the add menu at the cursor instead of sending it', async () => {
		const onSend = vi.fn< ( prompt: string ) => Promise< void > >();
		renderComposer( { onSend } );
		const textarea = screen.getByRole< HTMLTextAreaElement >( 'combobox' );
		fireEvent.change( textarea, { target: { value: 'Please audit' } } );
		textarea.setSelectionRange( 6, 6 );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^SEO Audit/ } ) );

		expect( textarea ).toHaveValue( 'Please /rank-me-up audit' );
		expect( onSend ).not.toHaveBeenCalled();
	} );

	it( 'turns auto-start on from the add menu and off from its chip', async () => {
		renderComposer( { canAutoStart: true } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		const autoStart = await screen.findByRole( 'option', { name: /^Auto-start/ } );
		await waitFor( () => expect( autoStart ).not.toHaveAttribute( 'aria-disabled' ) );
		fireEvent.click( autoStart );
		await waitFor( () =>
			expect( connectorMocks.setUserPreferences.mock.calls[ 0 ][ 0 ] ).toEqual( {
				autoStartSiteOnChat: true,
			} )
		);

		fireEvent.click( await screen.findByRole( 'button', { name: 'Remove Auto-start' } ) );
		await waitFor( () =>
			expect( connectorMocks.setUserPreferences.mock.calls[ 1 ][ 0 ] ).toEqual( {
				autoStartSiteOnChat: false,
			} )
		);
	} );

	it( 'switches to the live site from the add menu and back from its chip', async () => {
		const onEnvironmentChange = vi.fn();
		const { rerenderComposer } = renderComposer( {
			liveUrl: 'https://example.com',
			onEnvironmentChange,
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Work on live site/ } ) );
		expect( onEnvironmentChange ).toHaveBeenCalledWith( 'live' );

		rerenderComposer( {
			environment: 'live',
			liveUrl: 'https://example.com',
			onEnvironmentChange,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove Live' } ) );
		expect( onEnvironmentChange ).toHaveBeenLastCalledWith( 'local' );
	} );

	it( 'answers a pending question with typed text, but still queues skill commands', async () => {
		const onSend = vi.fn< ( prompt: string ) => Promise< void > >();
		const onAnswer = vi.fn();
		renderComposer( { busy: true, onSend, onAnswer } );

		const textarea = screen.getByPlaceholderText( 'Your answer' );
		fireEvent.change( textarea, { target: { value: 'Something warmer' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send answer' } ) );

		expect( onAnswer ).toHaveBeenCalledWith( 'Something warmer' );
		expect( textarea ).toHaveValue( '' );

		fireEvent.change( textarea, { target: { value: '/annotate' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue message' } ) );

		await waitFor( () => expect( onSend ).toHaveBeenCalledTimes( 1 ) );
		expect( onSend.mock.calls[ 0 ][ 0 ] ).toBe( '/annotate' );
		expect( onAnswer ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'lists the skills under their own heading, with descriptions', async () => {
		renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );

		const skills = await screen.findByRole( 'group', { name: 'Skills' } );
		const [ first ] = getAiSkillCommands();
		expect(
			within( skills ).getByRole( 'option', { name: /^Visual Annotations/ } )
		).toHaveTextContent( first.description );
	} );

	it( 'completes a slash command from the keyboard and keeps the text on Escape', async () => {
		renderComposer();
		const textarea = screen.getByRole( 'combobox' );

		fireEvent.change( textarea, { target: { value: 'Please /rank' } } );
		expect( await screen.findByRole( 'option', { name: /^SEO Audit/ } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		fireEvent.keyDown( textarea, { key: 'Enter' } );
		expect( textarea ).toHaveValue( 'Please /rank-me-up ' );

		fireEvent.change( textarea, { target: { value: '/' } } );
		await screen.findByRole( 'listbox', { name: 'Commands' } );
		fireEvent.keyDown( textarea, { key: 'Escape' } );
		await waitFor( () =>
			expect( screen.queryByRole( 'listbox', { name: 'Commands' } ) ).not.toBeInTheDocument()
		);
		expect( textarea ).toHaveValue( '/' );
	} );

	it( 'previews an attachment while its chip is hovered', async () => {
		const { container } = renderComposer();
		const textFile = new File( [ 'Attachment preview text' ], 'notes.txt', {
			type: 'text/plain',
		} );
		fireEvent.change( container.querySelector( 'input[type="file"]' ) as HTMLInputElement, {
			target: { files: [ textFile ] },
		} );

		fireEvent.mouseEnter( await screen.findByRole( 'listitem', { name: /^notes\.txt/ } ) );

		expect(
			await screen.findByText( 'Attachment preview text', {}, { timeout: 2000 } )
		).toBeInTheDocument();
	} );

	it( 'restores text and attachments independently for each session', async () => {
		const firstSession = renderComposer();
		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'Keep this draft for session one' },
		} );
		const textFile = new File( [ 'Attachment text' ], 'notes.txt', {
			type: 'text/plain',
		} );
		fireEvent.change(
			firstSession.container.querySelector( 'input[type="file"]' ) as HTMLInputElement,
			{ target: { files: [ textFile ] } }
		);
		await screen.findByRole( 'listitem', { name: /^notes\.txt/ } );
		firstSession.rerenderComposer( { sessionId: 'session-2' } );
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( '' );
		expect( screen.queryByRole( 'listitem' ) ).not.toBeInTheDocument();
		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'A different draft for session two' },
		} );

		firstSession.rerenderComposer();
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'Keep this draft for session one' );
		expect( screen.getByRole( 'listitem', { name: /^notes\.txt/ } ) ).toBeInTheDocument();
	} );

	it( 'clears the cached draft after sending', async () => {
		const onSend = vi.fn().mockResolvedValue( undefined );
		const firstRender = renderComposer( { onSend } );
		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'Send and clear this draft' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () =>
			expect( onSend ).toHaveBeenCalledWith( 'Send and clear this draft', {
				files: [],
				images: [],
			} )
		);
		firstRender.unmount();

		renderComposer();
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( '' );
	} );

	it( 'attaches images pasted outside the textarea and focuses the composer', async () => {
		renderComposer();

		const image = new File( [ 'image-bytes' ], '', { type: 'image/png' } );
		const pasteEvent = new Event( 'paste', { bubbles: true, cancelable: true } );
		Object.defineProperty( pasteEvent, 'clipboardData', {
			value: { files: [ image ], items: [] },
		} );
		fireEvent( document.body, pasteEvent );

		expect( pasteEvent.defaultPrevented ).toBe( true );
		expect(
			await screen.findByRole( 'listitem', { name: /^pasted-image\.png/ } )
		).toBeInTheDocument();
		expect( screen.getByRole( 'combobox' ) ).toHaveFocus();
	} );

	it( 'ignores pastes inside open dialogs', () => {
		renderComposer();

		const dialog = document.createElement( 'div' );
		dialog.setAttribute( 'role', 'dialog' );
		document.body.appendChild( dialog );

		const image = new File( [ 'image-bytes' ], '', { type: 'image/png' } );
		const pasteEvent = new Event( 'paste', { bubbles: true, cancelable: true } );
		Object.defineProperty( pasteEvent, 'clipboardData', {
			value: { files: [ image ], items: [] },
		} );
		fireEvent( dialog, pasteEvent );

		expect( pasteEvent.defaultPrevented ).toBe( false );
		expect( screen.queryByRole( 'listitem' ) ).not.toBeInTheDocument();

		dialog.remove();
	} );

	it( 'keeps the picked provider pin in the fresh session cache after a family switch', async () => {
		const queryClient = new QueryClient();
		const onSwitchSession = vi.fn();
		const freshSummary = createSummary( { id: 'fresh-session' } );
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		connectorMocks.createSession.mockResolvedValue( freshSummary );
		connectorMocks.setSessionProvider.mockResolvedValue( undefined );

		renderComposer(
			{
				model: 'balanced',
				entries: [ createUserPromptEntry() ],
				ownerSiteId: 'site-1',
				onSwitchSession,
			},
			queryClient
		);

		fireEvent.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Sonnet 5/ } ) );
		const dialog = await screen.findByRole( 'dialog' );
		expect( dialog ).toHaveTextContent( 'Start a new chat?' );
		expect( dialog ).toHaveTextContent(
			'Switching from Balanced to Sonnet 5 starts a fresh chat because the models don\u2019t share memory. You can find previous chats using Chat history below the chat box.'
		);
		expect( within( dialog ).getByText( 'Chat history' ).tagName ).toBe( 'STRONG' );
		expect( dialog ).not.toHaveTextContent( 'sidebar' );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Yes, new chat' } ) );

		await waitFor( () => {
			expect( onSwitchSession ).toHaveBeenCalledWith( 'fresh-session' );
		} );
		expect( connectorMocks.setSessionProvider ).toHaveBeenCalledWith(
			'fresh-session',
			'anthropic-api-key',
			'claude-sonnet-5'
		);

		const loadedSession = queryClient.getQueryData< LoadedAiSession >( [
			...SESSIONS_QUERY_KEY,
			'fresh-session',
		] );
		expect( loadedSession?.summary ).toEqual( freshSummary );
		expect( loadedSession?.entries ).toEqual( [
			expect.objectContaining( {
				customType: 'studio.session_context',
				data: { provider: 'anthropic-api-key', model: 'claude-sonnet-5' },
			} ),
		] );
	} );
} );

// Items carry a description after the name.
function getMenuLabels() {
	return screen.getAllByRole( 'option' ).map( ( item ) => item.textContent );
}

const startingWith = ( labels: string[] ) =>
	labels.map( ( label ) => expect.stringMatching( new RegExp( `^${ label }` ) ) );

function createSummary( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/tmp/session.jsonl',
		createdAt: '2026-06-26T11:00:00.000Z',
		updatedAt: '2026-06-26T11:00:00.000Z',
		ownerSitePath: '/Users/example/Studio/example-site',
		ownerSiteName: 'Example Site',
		activeEnvironment: 'local',
		eventCount: 0,
		...overrides,
	};
}

function createSessionContextEntry( provider: string ): SessionEntry {
	return {
		type: 'custom',
		id: 'session-context-1',
		parentId: null,
		timestamp: '2026-06-26T12:00:00.000Z',
		customType: 'studio.session_context',
		data: { provider, model: 'claude-sonnet-5' },
	} as SessionEntry;
}

function createUserPromptEntry(): SessionEntry {
	return {
		type: 'custom',
		id: 'user-prompt-1',
		parentId: null,
		timestamp: '2026-06-26T12:00:00.000Z',
		customType: 'studio.user_prompt',
		data: { text: 'Make the header calmer' },
	} as SessionEntry;
}
