import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { Composer } from '@/features/composer';
import { clearComposerDrafts } from '@/features/composer/draft-store';
import { aiSettings, createFakeConnector, makeSession } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { LoadedAiSession, SessionEntry } from '@/data/core';
import type { ModelFavorite } from '@studio/common/lib/user-settings/model-favorites';

const normal: ModelFavorite = {
	provider: 'anthropic-api-key',
	model: 'claude-sonnet-5-5',
	effort: 'default',
};
const high: ModelFavorite = { ...normal, effort: 'high' };
const unavailable: ModelFavorite = {
	provider: 'future-provider',
	model: 'future-model',
	effort: 'max',
};

function connectorFor( favorites: ModelFavorite[] = [ normal, high, unavailable ] ) {
	return createFakeConnector(
		{ preferences: { modelFavorites: favorites } },
		{
			getAiSettings: async () => aiSettings( 'anthropic', [ 'wpcom', 'anthropic' ] ),
			getStudioAssistantQuota: async () =>
				( { purchasedRemaining: 100, purchasedAtTopUp: 100 } ) as never,
		}
	);
}

beforeEach( () => clearComposerDrafts() );
afterEach( () => vi.restoreAllMocks() );

describe( 'Model favorites', () => {
	it( 'keeps the search open when choosing a model and saves a separate thinking preset', async () => {
		const connector = connectorFor( [ normal ] );
		const onModelChange = vi.fn();
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				thinking="high"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				onModelChange={ onModelChange }
				onSend={ vi.fn() }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		const search = screen.getByRole( 'textbox', { name: 'Search models' } );
		await user.type( search, 'Sonnet' );
		await user.click( screen.getByRole( 'button', { name: 'Star Sonnet 5.5 · High' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [ high, normal ] )
		);
		await user.clear( search );
		await user.type( search, 'Opus' );
		await user.click( screen.getByRole( 'button', { name: 'Opus 5.5 · High' } ) );
		expect( search ).toHaveValue( 'Opus' );
		expect( onModelChange ).toHaveBeenCalledWith( 'claude-opus-5-5', 'anthropic', 'high' );
	} );

	it( 'reorders favorites with the keyboard while preserving unavailable saved values', async () => {
		const connector = connectorFor();
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				onModelChange={ vi.fn() }
				onSend={ vi.fn() }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Reorder Sonnet 5.5 · High' } ), {
			key: 'ArrowUp',
		} );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				high,
				normal,
				{ provider: 'wpcom', model: 'fast', effort: 'default' },
				unavailable,
			] )
		);
	} );

	it( 'reorders favorites with a pointer without selecting a model', async () => {
		const fast: ModelFavorite = { provider: 'wpcom', model: 'fast', effort: 'default' };
		const connector = connectorFor( [ normal, high, fast ] );
		const onModelChange = vi.fn();
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				onModelChange={ onModelChange }
				onSend={ vi.fn() }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		const list = within( screen.getByRole( 'group', { name: 'Favorite models' } ) ).getByRole(
			'list'
		);
		Array.from( list.children ).forEach( ( row ) => {
			vi.spyOn( row, 'getBoundingClientRect' ).mockImplementation(
				() => new DOMRect( 0, Array.from( list.children ).indexOf( row ) * 32, 224, 32 )
			);
		} );
		const pointer = ( type: string, clientY: number ) => {
			const event = new MouseEvent( type, { bubbles: true, button: 0, clientY } );
			Object.defineProperty( event, 'pointerId', { value: 1 } );
			return event;
		};
		fireEvent(
			screen.getByRole( 'button', { name: 'Reorder Sonnet 5.5 · High' } ),
			pointer( 'pointerdown', 48 )
		);
		fireEvent( list, pointer( 'pointermove', 8 ) );
		fireEvent( list, pointer( 'pointerup', 8 ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [ high, normal, fast ] )
		);
		expect( onModelChange ).not.toHaveBeenCalled();
	} );

	it( 'keeps an unsaved current preset temporary until it is moved', async () => {
		const fast: ModelFavorite = { provider: 'wpcom', model: 'fast', effort: 'default' };
		const current: ModelFavorite = {
			provider: 'anthropic-api-key',
			model: 'claude-opus-5-5',
			effort: 'default',
		};
		const connector = connectorFor( [ normal, high, fast ] );
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-opus-5-5"
				provider="anthropic"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				onModelChange={ vi.fn() }
				onSend={ vi.fn() }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		const currentRow = screen.getByRole( 'button', { name: 'Opus 5.5' } );
		expect( currentRow ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( currentRow ).not.toHaveAttribute( 'aria-keyshortcuts' );
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Reorder Sonnet 5.5 · High' } ), {
			key: 'ArrowUp',
		} );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [ high, normal, fast ] )
		);
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Reorder Opus 5.5' } ), {
			key: 'ArrowUp',
		} );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				high,
				normal,
				current,
				fast,
			] )
		);
		expect( currentRow ).toHaveAttribute( 'aria-keyshortcuts' );
	} );

	it( 'applies a saved preset with its keyboard shortcut from the composer', async () => {
		vi.spyOn( navigator, 'platform', 'get' ).mockReturnValue( 'Win32' );
		const onModelChange = vi.fn();
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				onModelChange={ onModelChange }
				onSend={ vi.fn() }
				onInterrupt={ vi.fn() }
			/>,
			{ connector: connectorFor() }
		);
		const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await screen.findByRole( 'button', { name: 'Model' } );
		await user.type( input, 'Keep my draft' );
		fireEvent.keyDown( input, { key: '2', code: 'Digit2', ctrlKey: true, altKey: true } );
		expect( onModelChange ).toHaveBeenCalledWith( 'claude-sonnet-5-5', 'anthropic', 'high' );
		expect( input ).toHaveValue( 'Keep my draft' );
	} );

	it( 'distinguishes the same model served by two providers', async () => {
		const connector = createFakeConnector(
			{
				preferences: {
					modelFavorites: [
						normal,
						{ provider: 'github-copilot', model: 'claude-sonnet-5-5', effort: 'default' },
					],
				},
			},
			{ getAiSettings: async () => aiSettings( 'anthropic', [ 'anthropic', 'github-copilot' ] ) }
		);
		const onModelChange = vi.fn();
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				onModelChange={ onModelChange }
				onSend={ vi.fn() }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		expect( screen.getByRole( 'button', { name: 'Sonnet 5.5 · Anthropic' } ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await user.click( screen.getByRole( 'button', { name: 'Sonnet 5.5 · GitHub Copilot' } ) );
		expect( onModelChange ).toHaveBeenCalledWith(
			'claude-sonnet-5-5',
			'github-copilot',
			'default'
		);
	} );

	it( 'waits for a preset to be stored before sending a message', async () => {
		const connector = connectorFor();
		let finishWrite!: () => void;
		connector.setSessionModel.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finishWrite = resolve;
				} )
		);
		const onSend = vi.fn().mockResolvedValue( undefined );
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				entries={ [] }
				onSend={ onSend }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Sonnet 5.5 · High' } ) );
		await waitFor( () =>
			expect( connector.setSessionModel ).toHaveBeenCalledWith(
				'chat',
				'claude-sonnet-5-5',
				'high'
			)
		);
		await user.keyboard( '{Escape}' );
		await user.type(
			screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ),
			'Keep this draft'
		);
		await user.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( onSend ).not.toHaveBeenCalled();
		finishWrite();
		await waitFor( () => expect( onSend ).toHaveBeenCalledOnce() );
	} );

	it( 'applies rapid preset changes in order before sending', async () => {
		const connector = connectorFor();
		let finishFirst!: () => void;
		connector.setSessionModel
			.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						finishFirst = resolve;
					} )
			)
			.mockResolvedValue( undefined );
		const onSend = vi.fn().mockResolvedValue( undefined );
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				entries={ [] }
				onSend={ onSend }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Sonnet 5.5 · High' } ) );
		await waitFor( () => expect( connector.setSessionModel ).toHaveBeenCalledTimes( 1 ) );
		await user.click( screen.getByRole( 'button', { name: 'Sonnet 5.5' } ) );
		await user.keyboard( '{Escape}' );
		await user.type(
			screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ),
			'Hello'
		);
		await user.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( onSend ).not.toHaveBeenCalled();
		expect( connector.setSessionModel ).toHaveBeenCalledTimes( 1 );
		finishFirst();
		await waitFor( () =>
			expect( connector.setSessionModel ).toHaveBeenNthCalledWith(
				2,
				'chat',
				'claude-sonnet-5-5',
				'default'
			)
		);
		await waitFor( () => expect( onSend ).toHaveBeenCalledOnce() );
	} );

	it( 'keeps the draft when saving a preset fails', async () => {
		const connector = connectorFor();
		let failWrite!: ( error: Error ) => void;
		connector.setSessionModel.mockImplementation(
			() =>
				new Promise( ( _resolve, reject ) => {
					failWrite = reject;
				} )
		);
		const onSend = vi.fn().mockResolvedValue( undefined );
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				entries={ [] }
				onSend={ onSend }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Sonnet 5.5 · High' } ) );
		await waitFor( () => expect( connector.setSessionModel ).toHaveBeenCalled() );
		await user.keyboard( '{Escape}' );
		const input = screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await user.type( input, 'Keep this draft' );
		await user.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( onSend ).not.toHaveBeenCalled();
		failWrite( new Error( 'Write failed' ) );
		await waitFor( () => expect( input ).toHaveValue( 'Keep this draft' ) );
		expect( onSend ).not.toHaveBeenCalled();
	} );

	it( 'carries the selected thinking level to the confirmed new chat', async () => {
		const connector = connectorFor( [ high ] );
		connector.getAiSettings.mockResolvedValue( aiSettings( 'wpcom', [ 'wpcom', 'anthropic' ] ) );
		connector.createSession.mockResolvedValue( makeSession( { id: 'new-chat' } ) );
		const onSwitchSession = vi.fn();
		const { user, queryClient } = renderWithProviders(
			<Composer
				busy={ false }
				model="fast"
				provider="wpcom"
				thinking="default"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				ownerSiteId="site"
				entries={ [
					{
						type: 'custom',
						customType: 'studio.user_prompt',
						data: { text: 'Hello' },
					} as SessionEntry,
				] }
				onSwitchSession={ onSwitchSession }
				onSend={ vi.fn() }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Sonnet 5.5 · High' } ) );
		const dialog = await screen.findByRole( 'dialog', { name: 'Start a new chat?' } );
		await user.click( within( dialog ).getByRole( 'button', { name: 'Yes, new chat' } ) );
		await waitFor( () => expect( onSwitchSession ).toHaveBeenCalledWith( 'new-chat' ) );
		expect( connector.setSessionProvider ).toHaveBeenCalledWith(
			'new-chat',
			'anthropic',
			'claude-sonnet-5-5',
			'high'
		);
		const cached = queryClient.getQueryData< LoadedAiSession >( [
			...SESSIONS_QUERY_KEY,
			'new-chat',
		] );
		expect( cached?.entries ).toEqual( [
			expect.objectContaining( {
				customType: 'studio.session_context',
				data: { provider: 'anthropic-api-key', model: 'claude-sonnet-5-5', thinking: 'high' },
			} ),
		] );
	} );

	it( 'keeps the previous picker on servers that do not support favorites', async () => {
		const connector = connectorFor();
		connector.capabilities.modelFavorites = false;
		const { user } = renderWithProviders(
			<Composer
				busy={ false }
				model="claude-sonnet-5-5"
				provider="anthropic"
				onThinkingChange={ vi.fn() }
				sessionId="chat"
				onSend={ vi.fn() }
				onInterrupt={ vi.fn() }
			/>,
			{ connector }
		);
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		expect( await screen.findByRole( 'option', { name: /^Sonnet 5.5/ } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: /Star Sonnet/ } ) ).not.toBeInTheDocument();
	} );
} );
