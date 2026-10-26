import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createRef, useState, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { Button } from '@/lib/ui';
import { createFakeConnector, makeSession, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { Composer } from './composer';
import { clearComposerDrafts } from './draft-store';
import type { ComposerHandle } from './use-composer-handle';
import type { LoadedAiSession, SessionEntry } from '@/data/core';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

type Props = Partial< ComponentProps< typeof Composer > >;

const ANTHROPIC_KEY = {
	provider: 'wpcom' as const,
	hasAnthropicApiKey: true,
	anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
};

const OUT_OF_CREDITS = {
	costCap: 100,
	costUsage: 0,
	studioCodeAiHasAccess: true,
	studioCodeAiAccess: 'granted',
	hasPaymentMethod: true,
	allowanceRemaining: 0,
	purchasedRemaining: 0,
} as StudioAssistantQuota;

async function setup( props: Props = {}, connector = createFakeConnector() ) {
	const onSend = vi.fn< NonNullable< Props[ 'onSend' ] > >( async () => {} );
	const ref = createRef< ComposerHandle >();
	const view = renderWithProviders(
		<Composer
			ref={ ref }
			busy={ false }
			model={ DEFAULT_MODEL }
			sessionId="session-1"
			onSend={ onSend }
			onInterrupt={ vi.fn( async () => {} ) }
			entries={ [] }
			{ ...props }
		/>,
		{ connector }
	);
	const input = ( await screen.findByRole( 'combobox' ) ) as HTMLTextAreaElement;
	return { ...view, ref, input, onSend };
}

const modelButton = () => screen.findByRole( 'button', { name: 'Model' } );

const upload = ( name: string ) =>
	fireEvent.change( screen.getByLabelText( 'Upload attachments' ), {
		target: { files: [ new File( [ `${ name } text` ], name, { type: 'text/plain' } ) ] },
	} );

function paste( target: Element ) {
	const event = new Event( 'paste', { bubbles: true, cancelable: true } );
	Object.defineProperty( event, 'clipboardData', {
		value: { files: [ new File( [ 'image-bytes' ], '', { type: 'image/png' } ) ], items: [] },
	} );
	fireEvent( target, event );
	return event;
}

function sessionContextEntry( provider: string ): SessionEntry {
	return {
		type: 'custom',
		id: 'session-context-1',
		parentId: null,
		timestamp: '2026-06-26T12:00:00.000Z',
		customType: 'studio.session_context',
		data: { provider, model: 'claude-sonnet-5' },
	} as SessionEntry;
}

beforeEach( () => {
	clearComposerDrafts();
} );

describe( 'Composer model picker', () => {
	it( 'falls back to WordPress.com when a pinned conversation has no key', async () => {
		await setup( { entries: [ sessionContextEntry( 'anthropic-api-key' ) ] } );

		const trigger = await modelButton();
		await waitFor( () =>
			expect( trigger ).toHaveAccessibleDescription( 'Fast · WordPress.com · AI usage unavailable' )
		);
		fireEvent.click( trigger );
		await screen.findByRole( 'option', { name: /^Fast/ } );
		expect( screen.queryByRole( 'option', { name: /^Sonnet 5/ } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the AI credits left as a count, not a share of past top-ups', async () => {
		const connector = createFakeConnector();
		connector.getStudioAssistantQuota.mockResolvedValue( {
			costCap: 1_000_000,
			costUsage: 0,
			studioCodeAiHasAccess: true,
			hasPaymentMethod: true,
			allowanceRemaining: 200_000,
			purchasedRemaining: 1_000_000,
			purchasedAtTopUp: 5_000_000,
		} as StudioAssistantQuota );
		await setup( {}, connector );

		const trigger = await modelButton();
		await waitFor( () =>
			expect( trigger ).toHaveAccessibleDescription(
				'Fast · WordPress.com · AI credits: 1.2M remaining'
			)
		);
	} );

	it( 'unlocks the paid tiers for Automatticians without purchased credits', async () => {
		const connector = createFakeConnector( {
			user: { ...TEST_USER, email: 'person@automattic.com' },
		} );
		connector.getStudioAssistantQuota.mockResolvedValue( {
			purchasedRemaining: 0,
		} as StudioAssistantQuota );
		await setup( {}, connector );

		fireEvent.click( await modelButton() );
		for ( const tier of [ 'Balanced', 'Strong' ] ) {
			await waitFor( () =>
				expect(
					screen.getByRole( 'option', { name: new RegExp( `^${ tier }` ) } )
				).not.toHaveAttribute( 'aria-disabled' )
			);
		}
	} );

	it( 'keeps the picked provider pin in the fresh session cache after a family switch', async () => {
		const connector = createFakeConnector( {}, { getAiSettings: async () => ANTHROPIC_KEY } );
		const fresh = makeSession( { id: 'fresh-session' } );
		connector.createSession.mockResolvedValue( fresh );
		const onSwitchSession = vi.fn();
		const { queryClient } = await setup(
			{
				model: 'balanced',
				entries: [
					{
						type: 'custom',
						id: 'user-prompt-1',
						customType: 'studio.user_prompt',
						data: { text: 'Make the header calmer' },
					} as SessionEntry,
				],
				ownerSiteId: 'site-1',
				onSwitchSession,
			},
			connector
		);

		fireEvent.click( await modelButton() );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Sonnet 5/ } ) );
		const dialog = await screen.findByRole( 'dialog' );
		expect( dialog ).toHaveTextContent( 'Start a new chat?' );
		expect( dialog ).toHaveTextContent(
			'Switching from Balanced to Sonnet 5 starts a fresh chat because the models don’t share memory. You can find previous chats using Chat history below the chat box.'
		);
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Yes, new chat' } ) );

		await waitFor( () => expect( onSwitchSession ).toHaveBeenCalledWith( 'fresh-session' ) );
		expect( connector.setSessionProvider ).toHaveBeenCalledWith(
			'fresh-session',
			'anthropic-api-key',
			'claude-sonnet-5'
		);
		const cached = queryClient.getQueryData< LoadedAiSession >( [
			...SESSIONS_QUERY_KEY,
			'fresh-session',
		] );
		expect( cached?.summary ).toEqual( fresh );
		expect( cached?.entries ).toEqual( [
			expect.objectContaining( {
				customType: 'studio.session_context',
				data: { provider: 'anthropic-api-key', model: 'claude-sonnet-5' },
			} ),
		] );
	} );
} );

describe( 'Composer as a form field', () => {
	it( 'has no send control and hands its draft over through the ref', async () => {
		const onModelChange = vi.fn();
		const { connector, ref, input, onSend } = await setup( {
			variant: 'field',
			model: 'balanced',
			sessionId: undefined,
			placeholder: 'Describe the site',
			onModelChange,
		} );

		expect( screen.queryByRole( 'button', { name: 'Send message' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Add' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Upload attachment' } ) ).toBeInTheDocument();
		expect( ref.current?.getSubmission() ).toBeNull();

		expect( input ).toHaveAttribute( 'placeholder', 'Describe the site' );
		fireEvent.change( input, { target: { value: 'A bright ceramics portfolio' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( onSend ).not.toHaveBeenCalled();

		fireEvent.change( screen.getByLabelText( 'Upload attachments' ), {
			target: { files: [ new File( [ 'image-bytes' ], 'moodboard.png', { type: 'image/png' } ) ] },
		} );
		await screen.findByRole( 'listitem', { name: /^moodboard\.png/ } );
		expect( ref.current?.getSubmission() ).toMatchObject( {
			prompt: 'A bright ceramics portfolio',
			attachments: { images: [ expect.objectContaining( { name: 'moodboard.png' } ) ], files: [] },
		} );

		fireEvent.click( await modelButton() );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Fast/ } ) );
		expect( onModelChange ).toHaveBeenCalledWith( 'fast' );
		expect( connector.setSessionModel ).not.toHaveBeenCalled();
	} );
} );

describe( 'Composer sending', () => {
	it( 'holds sends behind the out-of-credits notice and flags a blocked send', async () => {
		const connector = createFakeConnector();
		connector.getStudioAssistantQuota.mockResolvedValue( OUT_OF_CREDITS );
		const { input, onSend } = await setup( {}, connector );

		const notice = await screen.findByRole( 'alert' );
		expect( notice ).toHaveTextContent( 'Add AI credits to send another message.' );
		expect( within( notice ).getByRole( 'button', { name: 'Add credits' } ) ).toBeInTheDocument();

		fireEvent.change( input, { target: { value: 'One more' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( onSend ).not.toHaveBeenCalled();
		expect( notice ).toHaveAttribute( 'data-feedback' );
		expect( input ).toHaveValue( 'One more' );
	} );

	it( 'does not hold an Anthropic chat behind WordPress.com credits', async () => {
		const connector = createFakeConnector( {}, { getAiSettings: async () => ANTHROPIC_KEY } );
		connector.getStudioAssistantQuota.mockResolvedValue( OUT_OF_CREDITS );
		const { input, onSend } = await setup(
			{ model: 'claude-sonnet-5', entries: [ sessionContextEntry( 'anthropic-api-key' ) ] },
			connector
		);
		const trigger = await modelButton();
		await waitFor( () =>
			expect( trigger ).toHaveAccessibleDescription( 'Sonnet 5 · Anthropic API' )
		);

		fireEvent.change( input, { target: { value: 'One more' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );

	it( 'answers a pending question with typed text, but still queues skill commands', async () => {
		const onAnswer = vi.fn();
		const { input, onSend } = await setup( { busy: true, onAnswer } );

		expect( input ).toHaveAttribute( 'placeholder', 'Your answer' );
		fireEvent.change( input, { target: { value: 'Something warmer' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send answer' } ) );
		expect( onAnswer ).toHaveBeenCalledWith( 'Something warmer' );
		expect( input ).toHaveValue( '' );

		fireEvent.change( input, { target: { value: '/annotate' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue message' } ) );

		await waitFor( () => expect( onSend ).toHaveBeenCalledOnce() );
		expect( onSend.mock.calls[ 0 ][ 0 ] ).toBe( '/annotate' );
		expect( onAnswer ).toHaveBeenCalledOnce();
	} );
} );

describe( 'Composer drafts and attachments', () => {
	it( 'previews an attachment while its chip is hovered', async () => {
		await setup();
		upload( 'notes.txt' );

		fireEvent.mouseEnter( await screen.findByRole( 'listitem', { name: /^notes\.txt/ } ) );

		expect(
			await screen.findByText( 'notes.txt text', {}, { timeout: 2000 } )
		).toBeInTheDocument();
	} );

	it( 'restores text and attachments independently for each session', async () => {
		function SwitchingComposer() {
			const [ sessionId, setSessionId ] = useState( 'session-1' );
			return (
				<>
					<Button onClick={ () => setSessionId( 'session-1' ) }>Session 1</Button>
					<Button onClick={ () => setSessionId( 'session-2' ) }>Session 2</Button>
					<Composer
						busy={ false }
						model={ DEFAULT_MODEL }
						sessionId={ sessionId }
						onSend={ vi.fn( async () => {} ) }
						onInterrupt={ vi.fn( async () => {} ) }
						entries={ [] }
					/>
				</>
			);
		}
		renderWithProviders( <SwitchingComposer /> );
		const input = await screen.findByRole( 'combobox' );
		fireEvent.change( input, { target: { value: 'Keep this draft for session one' } } );
		upload( 'notes.txt' );
		await screen.findByRole( 'listitem', { name: /^notes\.txt/ } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Session 2' } ) );
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( '' );
		expect( screen.queryByRole( 'listitem' ) ).not.toBeInTheDocument();
		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'A different draft for session two' },
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Session 1' } ) );
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'Keep this draft for session one' );
		expect( screen.getByRole( 'listitem', { name: /^notes\.txt/ } ) ).toBeInTheDocument();
	} );

	it( 'attaches images pasted outside the textarea and focuses the composer', async () => {
		const { input } = await setup();

		expect( paste( document.body ).defaultPrevented ).toBe( true );
		expect(
			await screen.findByRole( 'listitem', { name: /^pasted-image\.png/ } )
		).toBeInTheDocument();
		expect( input ).toHaveFocus();
	} );

	it( 'ignores pastes inside open dialogs', async () => {
		await setup();
		const dialog = document.createElement( 'div' );
		dialog.setAttribute( 'role', 'dialog' );
		document.body.appendChild( dialog );

		expect( paste( dialog ).defaultPrevented ).toBe( false );
		expect( screen.queryByRole( 'listitem' ) ).not.toBeInTheDocument();
		dialog.remove();
	} );
} );
