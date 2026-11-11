import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '@/features/composer';
import { clearComposerDrafts } from '@/features/composer/draft-store';
import { Dialog, DialogContent, DialogTitle } from '@/lib/ui';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { AiModelId } from '@studio/agent/protocol/models';
import type { AiProviderId } from '@studio/agent/protocol/providers';
import type { ModelFavorite } from '@studio/common/lib/user-settings/model-favorites';

const favorites: ModelFavorite[] = [
	{ provider: 'wpcom', model: 'balanced', effort: 'default' },
	{ provider: 'wpcom', model: 'balanced', effort: 'high' },
	{ provider: 'anthropic-api-key', model: 'claude-sonnet-5', effort: 'default' },
];

let restoreAnimate: ( () => void ) | undefined;

afterEach( () => {
	document.documentElement.style.removeProperty( '--motion-duration-surface' );
	restoreAnimate?.();
	restoreAnimate = undefined;
	vi.restoreAllMocks();
} );

function mockLanding() {
	const descriptor = Object.getOwnPropertyDescriptor( Element.prototype, 'animate' );
	const animation = { cancel: vi.fn(), onfinish: null as ( () => void ) | null };
	const animate = vi.fn( () => animation as unknown as Animation );
	Object.defineProperty( Element.prototype, 'animate', { value: animate, configurable: true } );
	restoreAnimate = () => {
		if ( descriptor ) Object.defineProperty( Element.prototype, 'animate', descriptor );
		else delete ( Element.prototype as Partial< Element > ).animate;
	};
	return { animate, animation };
}

function dragFixture( group = 'Favorite models' ) {
	const list = within( screen.getByRole( 'group', { name: group } ) ).getByRole( 'list' );
	Array.from( list.children ).forEach( ( row ) => {
		vi.spyOn( row, 'getBoundingClientRect' ).mockImplementation(
			() => new DOMRect( 0, Array.from( list.children ).indexOf( row ) * 32, 224, 32 )
		);
	} );
	const pointer = ( type: string, clientY: number, pointerId = 1 ) => {
		const event = new MouseEvent( type, { bubbles: true, button: 0, clientY } );
		Object.defineProperty( event, 'pointerId', { value: pointerId } );
		return event;
	};
	return {
		list,
		pointer,
		handle: screen.getByRole( 'button', { name: 'Reorder Balanced' } ),
	};
}

async function setup(
	saved: ModelFavorite[] = favorites,
	initialModel: AiModelId = 'balanced',
	{ busy = false, purchasedRemaining = 500, provider = 'wpcom' as AiProviderId } = {}
) {
	clearComposerDrafts();
	const connector = createFakeConnector(
		{ preferences: { modelFavorites: saved } },
		{
			getAiSettings: async () => ( {
				provider: 'wpcom',
				hasAnthropicApiKey: true,
				anthropicApiKeyPreview: null,
			} ),
			getStudioAssistantQuota: async () =>
				( { purchasedRemaining, purchasedAtTopUp: purchasedRemaining } ) as never,
		}
	);
	const onSend = vi.fn();
	const onModelChange = vi.fn();
	const view = renderWithProviders(
		<Composer
			model={ initialModel }
			provider={ provider }
			busy={ busy }
			sessionId="test-favorites"
			onSend={ onSend }
			onInterrupt={ vi.fn() }
			onModelChange={ onModelChange }
		/>,
		{ connector }
	);
	const trigger = await screen.findByRole( 'button', { name: 'Model' } );
	await waitFor( () => expect( connector.getAiSettings ).toHaveBeenCalled() );
	await view.user.click( trigger );
	return { ...view, connector, onSend, onModelChange, trigger };
}

describe( 'Model favorites and effort', () => {
	it.each( [ 'MacIntel', 'Win32' ] )(
		'switches to a starred model and effort from the draft with the picker closed on %s',
		async ( platform ) => {
			vi.spyOn( navigator, 'platform', 'get' ).mockReturnValue( platform );
			const { user, onSend, onModelChange, trigger } = await setup();
			await user.keyboard( '{Escape}' );
			const input = screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
			await user.type( input, 'Keep my draft' );
			fireEvent.keyDown( input, {
				key: platform === 'MacIntel' ? '™' : '2',
				code: 'Digit2',
				altKey: true,
				metaKey: platform === 'MacIntel',
				ctrlKey: platform !== 'MacIntel',
			} );
			expect( onModelChange ).toHaveBeenCalledWith( 'balanced', 'wpcom' );
			expect( input ).toHaveValue( 'Keep my draft' );
			expect( trigger ).toHaveTextContent( 'Balanced · High' );
			await user.click( screen.getByRole( 'button', { name: 'Send message' } ) );
			expect( onSend ).toHaveBeenCalledWith(
				'Keep my draft',
				expect.objectContaining( { model: 'balanced', effort: 'high' } )
			);
		}
	);

	it( 'updates shortcut positions after reordering and keeps them stable while filtering', async () => {
		const unavailable: ModelFavorite = {
			provider: 'future-provider',
			model: 'future-model',
			effort: 'default',
		};
		const { user, connector, onModelChange } = await setup( [ ...favorites, unavailable ] );
		const high = screen.getByRole( 'button', { name: 'Balanced · High' } );
		const firstShortcut = screen
			.getByRole( 'button', { name: 'Balanced' } )
			.getAttribute( 'aria-keyshortcuts' );
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Reorder Balanced · High' } ), {
			key: 'ArrowUp',
		} );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				favorites[ 1 ],
				favorites[ 0 ],
				favorites[ 2 ],
				unavailable,
			] )
		);
		expect( high ).toHaveAttribute( 'aria-keyshortcuts', firstShortcut );
		const search = screen.getByRole( 'textbox', { name: 'Search models' } );
		await user.type( search, 'high' );
		expect( high ).toHaveAttribute( 'aria-keyshortcuts', firstShortcut );
		fireEvent.keyDown( search, { key: '1', code: 'Digit1', ctrlKey: true, altKey: true } );
		expect( onModelChange ).toHaveBeenCalledWith( 'balanced', 'wpcom' );
		expect( screen.getByRole( 'button', { name: 'Model' } ) ).toHaveTextContent(
			'Balanced · High'
		);
	} );

	it.each( [ { busy: true }, { purchasedRemaining: 0 } ] )(
		'keeps shortcuts from selecting busy or locked models: %j',
		async ( options ) => {
			const { onModelChange } = await setup( favorites, 'balanced', options );
			fireEvent.keyDown( document.body, { key: '2', code: 'Digit2', ctrlKey: true, altKey: true } );
			expect( onModelChange ).not.toHaveBeenCalled();
		}
	);

	it( 'leaves plain keys, composing text, unrelated fields and dialogs alone', async () => {
		const { user, onModelChange } = await setup();
		await user.keyboard( '{Escape}' );
		const shortcut = { key: '2', code: 'Digit2', ctrlKey: true, altKey: true };
		for ( const event of [
			{ key: '2', code: 'Digit2' },
			{ ...shortcut, repeat: true },
			{ ...shortcut, isComposing: true },
			{ ...shortcut, shiftKey: true },
		] )
			fireEvent.keyDown( document.body, event );
		const field = renderWithProviders( <input aria-label="Other field" /> );
		fireEvent.keyDown( await screen.findByRole( 'textbox', { name: 'Other field' } ), shortcut );
		field.unmount();
		const modal = renderWithProviders(
			<Dialog open>
				<DialogContent>
					<DialogTitle>Confirm action</DialogTitle>
				</DialogContent>
			</Dialog>
		);
		await screen.findByRole( 'dialog', { name: 'Confirm action' } );
		fireEvent.keyDown( document.body, shortcut );
		expect( onModelChange ).not.toHaveBeenCalled();
		modal.unmount();
		fireEvent.keyDown( document.body, shortcut );
		expect( onModelChange ).toHaveBeenCalledWith( 'balanced', 'wpcom' );
	} );

	it( 'saves separate medium and high favorites for the same model', async () => {
		const { user, connector } = await setup( [ favorites[ 0 ] ] );
		await user.click( screen.getByRole( 'button', { name: 'Effort: Medium' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'High' } ) );
		await user.type( screen.getByRole( 'textbox', { name: 'Search models' } ), 'balanced' );
		await user.click( screen.getByRole( 'button', { name: 'Star Balanced · High' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				favorites[ 1 ],
				favorites[ 0 ],
			] )
		);
		await user.clear( screen.getByRole( 'textbox', { name: 'Search models' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Unstar Balanced · High' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [ favorites[ 0 ] ] )
		);
	} );

	it( 'saves on drop and lands the preview in the new slot without selecting a model', async () => {
		const { connector, user, onModelChange } = await setup();
		document.documentElement.style.setProperty( '--motion-duration-surface', '180ms' );
		const { animation, animate } = mockLanding();
		const { list, pointer, handle } = dragFixture();
		fireEvent( handle, pointer( 'pointerdown', 16 ) );
		fireEvent( list, pointer( 'pointermove', 60 ) );
		fireEvent( list, pointer( 'pointerup', 60 ) );
		expect( document.querySelector( '[data-reorder-preview]' ) ).toBeInTheDocument();
		expect( handle.closest( '[data-reorder-id]' ) ).toHaveAttribute( 'data-dropping', 'true' );
		expect( animate ).toHaveBeenCalledWith(
			expect.any( Array ),
			expect.objectContaining( { duration: 180, fill: 'forwards' } )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Balanced · High' } ) );
		expect( onModelChange ).not.toHaveBeenCalled();
		await waitFor( () => expect( connector.setUserPreferences ).toHaveBeenCalledOnce() );
		act( () => animation.onfinish?.() );
		expect( document.querySelector( '[data-reorder-preview]' ) ).not.toBeInTheDocument();
		expect(
			within( list ).getAllByRole( 'button', { name: /^Reorder / } )[ 0 ]
		).toHaveAccessibleName( 'Reorder Balanced · High' );
		expect( screen.getByRole( 'textbox', { name: 'Search models' } ) ).toHaveFocus();
		await user.click( screen.getByRole( 'button', { name: 'Balanced · High' } ) );
		expect( onModelChange ).toHaveBeenCalledWith( 'balanced', 'wpcom' );
	} );

	it.each( [ 'escape', 'pointercancel' ] )(
		'cancels a drag on %s without saving or swallowing the next selection',
		async ( reason ) => {
			const { connector, user, onModelChange } = await setup( favorites, 'claude-opus-5', {
				provider: 'anthropic-api-key',
			} );
			const { list, pointer } = dragFixture( 'Available models' );
			const handle = screen.getByRole( 'button', { name: 'Reorder Opus 5' } );
			fireEvent( handle, pointer( 'pointerdown', 112 ) );
			fireEvent( list, pointer( 'pointermove', 6 ) );
			if ( reason === 'escape' ) fireEvent.keyDown( handle, { key: 'Escape' } );
			else fireEvent( list, pointer( reason, 6 ) );
			fireEvent( list, pointer( 'pointerup', 6 ) );
			expect( document.querySelector( '[data-reorder-preview]' ) ).not.toBeInTheDocument();
			expect( connector.state.preferences.modelFavorites ).toEqual( favorites );
			expect( connector.setUserPreferences ).not.toHaveBeenCalled();
			expect( screen.getByRole( 'dialog', { name: 'Choose a model' } ) ).toBeVisible();
			const choice = screen.getByRole( 'button', { name: 'Balanced · High' } );
			if ( reason === 'escape' ) {
				choice.focus();
				await user.keyboard( '{Enter}' );
			} else await user.click( choice );
			expect( onModelChange ).toHaveBeenCalledWith( 'balanced', 'wpcom' );
		}
	);

	it( 'commits without a landing delay when reduced motion is preferred', async () => {
		const matchMedia = window.matchMedia.bind( window );
		vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query ) => ( {
			...matchMedia( query ),
			matches: query === '(prefers-reduced-motion: reduce)',
		} ) );
		const { connector } = await setup();
		document.documentElement.style.setProperty( '--motion-duration-surface', '180ms' );
		const { animate } = mockLanding();
		const { list, pointer, handle } = dragFixture();
		fireEvent( handle, pointer( 'pointerdown', 16 ) );
		fireEvent( list, pointer( 'pointermove', 48 ) );
		fireEvent( list, pointer( 'pointerup', 48 ) );
		expect( document.querySelector( '[data-reorder-preview]' ) ).not.toBeInTheDocument();
		expect( animate ).not.toHaveBeenCalled();
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites?.[ 0 ] ).toEqual( favorites[ 1 ] )
		);
	} );

	it( 'starts only from the handle and leaves the order unchanged when dropped outside', async () => {
		const { connector } = await setup();
		const { list, pointer, handle } = dragFixture();
		fireEvent( screen.getByRole( 'button', { name: 'Balanced' } ), pointer( 'pointerdown', 16 ) );
		fireEvent( window, pointer( 'pointermove', 60 ) );
		expect( document.querySelector( '[data-reorder-preview]' ) ).not.toBeInTheDocument();
		fireEvent( window, pointer( 'pointerup', 60 ) );
		fireEvent( handle, pointer( 'pointerdown', 16 ) );
		fireEvent( window, pointer( 'pointermove', 200 ) );
		expect( document.querySelector( '[data-reorder-preview]' ) ).toBeInTheDocument();
		expect( list.querySelector( '[data-drop-position]' ) ).not.toBeInTheDocument();
		fireEvent( window, pointer( 'pointerup', 200 ) );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
	} );

	it( 'searches the connected catalog and fills starter slots after saving a result', async () => {
		const { user, onModelChange, connector } = await setup( [] );
		const search = screen.getByRole( 'textbox', { name: 'Search models' } );
		await user.type( search, 'opus' );
		await user.click( screen.getByRole( 'button', { name: 'Star Opus 5' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				{ provider: 'anthropic-api-key', model: 'claude-opus-5', effort: 'default' },
			] )
		);
		await user.clear( search );
		expect( screen.getByRole( 'button', { name: 'Opus 5' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Balanced', pressed: true } ) ).toBeVisible();
		expect( screen.getAllByRole( 'button', { name: /^Reorder / } ) ).toHaveLength( 3 );
		await user.type( search, 'no matching model' );
		expect( screen.getByText( 'No matching models.' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Effort: Medium' } ) ).toBeVisible();
		expect( onModelChange ).not.toHaveBeenCalled();
	} );

	it( 'limits starter models to three and searches the full connected catalog', async () => {
		const { user } = await setup( [] );
		const available = screen.getByRole( 'group', { name: 'Available models' } );
		expect( within( available ).getAllByRole( 'button', { name: /^Reorder / } ) ).toHaveLength( 3 );
		expect( screen.queryByRole( 'button', { name: 'Sonnet 5' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Opus 5' } ) ).not.toBeInTheDocument();
		const search = screen.getByRole( 'textbox', { name: 'Search models' } );
		await user.type( search, 'claude' );
		expect( screen.getByRole( 'button', { name: 'Sonnet 5' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Opus 5' } ) ).toBeVisible();
		await user.clear( search );
		expect(
			within( screen.getByRole( 'group', { name: 'Available models' } ) ).getAllByRole( 'button', {
				name: /^Reorder /,
			} )
		).toHaveLength( 3 );
	} );

	it( 'keeps starter choices when adding and removing favorites, including after reopening', async () => {
		const { user, connector, trigger, onModelChange } = await setup( [] );
		const strong = { provider: 'wpcom', model: 'strong', effort: 'default' };
		await user.click( screen.getByRole( 'button', { name: 'Star Strong' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [ strong ] )
		);
		for ( const label of [ 'Fast', 'Balanced', 'Strong' ] ) {
			expect( screen.getByRole( 'button', { name: label } ) ).toBeVisible();
		}
		expect( screen.getAllByRole( 'button', { name: /^Reorder / } ) ).toHaveLength( 3 );
		expect( screen.getByRole( 'button', { name: 'Fast' } ) ).not.toHaveAttribute(
			'aria-keyshortcuts'
		);
		await user.click( trigger );
		await user.click( trigger );
		expect( screen.getByRole( 'button', { name: 'Fast' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Balanced', pressed: true } ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Star Balanced' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [ favorites[ 0 ], strong ] )
		);
		expect( screen.getByRole( 'button', { name: 'Fast' } ) ).toBeVisible();
		expect( screen.getAllByRole( 'button', { name: /^Reorder / } ) ).toHaveLength( 3 );
		await user.click( screen.getByRole( 'button', { name: 'Unstar Balanced' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [ strong ] )
		);
		expect( screen.getByRole( 'button', { name: 'Balanced', pressed: true } ) ).toBeVisible();
		expect( screen.getAllByRole( 'button', { name: /^Reorder / } ) ).toHaveLength( 3 );
		expect( screen.queryByRole( 'button', { name: 'Sonnet 5' } ) ).not.toBeInTheDocument();
		expect( onModelChange ).not.toHaveBeenCalled();
	} );

	it( 'keeps the current model in the remaining starter slot beside two favorites', async () => {
		await setup(
			[ favorites[ 2 ], { provider: 'wpcom', model: 'strong', effort: 'default' } ],
			'claude-opus-5',
			{ provider: 'anthropic-api-key' }
		);
		expect( screen.getByRole( 'button', { name: 'Sonnet 5' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Strong' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Opus 5', pressed: true } ) ).toBeVisible();
		expect( screen.getAllByRole( 'button', { name: /^Reorder / } ) ).toHaveLength( 3 );
		expect( screen.queryByRole( 'button', { name: 'Fast' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the current preset unsaved when another favorite moves', async () => {
		const { connector } = await setup( favorites, 'claude-opus-5', {
			provider: 'anthropic-api-key',
		} );
		expect( screen.getByRole( 'button', { name: 'Opus 5', pressed: true } ) ).not.toHaveAttribute(
			'aria-keyshortcuts'
		);
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Reorder Balanced · High' } ), {
			key: 'ArrowUp',
		} );
		const reordered = [ favorites[ 1 ], favorites[ 0 ], favorites[ 2 ] ];
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( reordered )
		);
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Reorder Sonnet 5' } ), {
			key: 'ArrowDown',
		} );
		await waitFor( () => expect( connector.setUserPreferences ).toHaveBeenCalledTimes( 2 ) );
		expect( connector.state.preferences.modelFavorites ).toEqual( reordered );
		expect( screen.getByRole( 'button', { name: 'Opus 5', pressed: true } ) ).not.toHaveAttribute(
			'aria-keyshortcuts'
		);
		expect( screen.getAllByRole( 'button', { name: /^Reorder / } ).at( -1 ) ).toHaveAccessibleName(
			'Reorder Opus 5'
		);
	} );

	it( 'saves the current preset at its pointer drop position and assigns its shortcut', async () => {
		const { connector, onModelChange, trigger, user } = await setup( favorites, 'claude-opus-5', {
			provider: 'anthropic-api-key',
		} );
		const firstShortcut = screen
			.getByRole( 'button', { name: 'Balanced' } )
			.getAttribute( 'aria-keyshortcuts' );
		const { list, pointer } = dragFixture( 'Available models' );
		const handle = screen.getByRole( 'button', { name: 'Reorder Opus 5' } );
		fireEvent( handle, pointer( 'pointerdown', 112 ) );
		fireEvent( list, pointer( 'pointermove', 6 ) );
		fireEvent( list, pointer( 'pointerup', 6 ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				{ provider: 'anthropic-api-key', model: 'claude-opus-5', effort: 'default' },
				...favorites,
			] )
		);
		expect( screen.getAllByRole( 'button', { name: 'Opus 5' } ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'button', { name: 'Opus 5', pressed: true } ) ).toHaveAttribute(
			'aria-keyshortcuts',
			firstShortcut
		);
		expect( screen.getByRole( 'button', { name: 'Unstar Opus 5' } ) ).toBeVisible();
		expect( onModelChange ).not.toHaveBeenCalled();
		await user.click( trigger );
		await user.click( trigger );
		expect( screen.getByRole( 'button', { name: 'Opus 5' } ) ).toHaveAttribute(
			'aria-keyshortcuts',
			firstShortcut
		);
	} );

	it( 'saves the current model and effort at its keyboard reorder position without selecting it', async () => {
		const { user, connector, onModelChange } = await setup( favorites, 'claude-opus-5', {
			provider: 'anthropic-api-key',
		} );
		const thirdShortcut = screen
			.getByRole( 'button', { name: 'Sonnet 5' } )
			.getAttribute( 'aria-keyshortcuts' );
		await user.click( screen.getByRole( 'button', { name: 'Effort: Medium' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'High' } ) );
		const changes = onModelChange.mock.calls.length;
		const handle = screen.getByRole( 'button', { name: 'Reorder Opus 5 · High' } );
		handle.focus();
		await user.keyboard( '{ArrowUp}' );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				favorites[ 0 ],
				favorites[ 1 ],
				{ provider: 'anthropic-api-key', model: 'claude-opus-5', effort: 'high' },
				favorites[ 2 ],
			] )
		);
		expect(
			screen.getByRole( 'button', { name: 'Opus 5 · High', pressed: true } )
		).toHaveAttribute( 'aria-keyshortcuts', thirdShortcut );
		expect( handle ).toHaveFocus();
		expect( onModelChange ).toHaveBeenCalledTimes( changes );
	} );

	it( 'shows an unsaved current effort without changing favorite shortcuts and removes it on an exact match', async () => {
		const saved: ModelFavorite[] = [
			favorites[ 0 ],
			favorites[ 2 ],
			{ provider: 'wpcom', model: 'fast', effort: 'default' },
		];
		const { user, connector } = await setup( saved );
		const labels = [ 'Balanced', 'Sonnet 5', 'Fast' ];
		const shortcuts = labels.map( ( label ) =>
			screen.getByRole( 'button', { name: label } ).getAttribute( 'aria-keyshortcuts' )
		);
		await user.click( screen.getByRole( 'button', { name: 'Effort: Medium' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'High' } ) );
		const current = screen.getByRole( 'button', { name: 'Balanced · High', pressed: true } );
		expect( current ).toBeVisible();
		expect( current ).not.toHaveAttribute( 'aria-keyshortcuts' );
		expect( screen.getAllByRole( 'button', { name: 'Balanced · High' } ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'button', { name: 'Reorder Balanced · High' } ) ).toBeVisible();
		labels.forEach( ( label, index ) => {
			expect( screen.getByRole( 'button', { name: label } ) ).toHaveAttribute(
				'aria-keyshortcuts',
				shortcuts[ index ]
			);
		} );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: 'Effort: High' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'Medium' } ) );
		expect( screen.queryByRole( 'button', { name: 'Balanced · High' } ) ).not.toBeInTheDocument();
		expect( screen.getAllByRole( 'button', { name: 'Balanced' } ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'button', { name: 'Balanced', pressed: true } ) ).toHaveAttribute(
			'aria-keyshortcuts',
			shortcuts[ 0 ]
		);
		expect( connector.state.preferences.modelFavorites ).toEqual( saved );
	} );

	it( 'stars and unstars the current selection as one favorite without duplicate rows', async () => {
		const { user, connector, onModelChange } = await setup( favorites, 'claude-opus-5', {
			provider: 'anthropic-api-key',
		} );
		const firstShortcut = screen
			.getByRole( 'button', { name: 'Balanced' } )
			.getAttribute( 'aria-keyshortcuts' );
		await user.click( screen.getByRole( 'button', { name: 'Star Opus 5' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				{ provider: 'anthropic-api-key', model: 'claude-opus-5', effort: 'default' },
				...favorites,
			] )
		);
		expect( screen.getAllByRole( 'button', { name: 'Opus 5' } ) ).toHaveLength( 1 );
		expect(
			within( screen.getByRole( 'group', { name: 'Favorite models' } ) ).getByRole( 'button', {
				name: 'Opus 5',
				pressed: true,
			} )
		).toHaveAttribute( 'aria-keyshortcuts', firstShortcut );
		await user.click( screen.getByRole( 'button', { name: 'Unstar Opus 5' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( favorites )
		);
		expect( screen.getAllByRole( 'button', { name: 'Opus 5' } ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'button', { name: 'Opus 5', pressed: true } ) ).not.toHaveAttribute(
			'aria-keyshortcuts'
		);
		expect( screen.getByRole( 'button', { name: 'Balanced' } ) ).toHaveAttribute(
			'aria-keyshortcuts',
			firstShortcut
		);
		expect( onModelChange ).not.toHaveBeenCalled();
	} );

	it( 'keeps more than three saved favorites visible', async () => {
		await setup( [ ...favorites, { provider: 'wpcom', model: 'strong', effort: 'default' } ] );
		expect(
			within( screen.getByRole( 'group', { name: 'Favorite models' } ) ).getAllByRole( 'button', {
				name: /^Reorder /,
			} )
		).toHaveLength( 4 );
	} );

	it( 'saves a pointer reorder of the default list without selecting a model', async () => {
		const { connector, onModelChange } = await setup( [] );
		const { list, pointer, handle } = dragFixture( 'Available models' );
		fireEvent( handle, pointer( 'pointerdown', 48 ) );
		fireEvent( list, pointer( 'pointermove', 6 ) );
		fireEvent( list, pointer( 'pointerup', 6 ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites?.map( ( item ) => item.model ) ).toEqual( [
				'balanced',
				'fast',
				'strong',
			] )
		);
		expect( onModelChange ).not.toHaveBeenCalled();
	} );

	it( 'filters favorites by effort and supports keyboard selection from search', async () => {
		const { user, trigger } = await setup();
		const search = screen.getByRole( 'textbox', { name: 'Search models' } );
		await user.type( search, 'balanced medium' );
		expect( screen.getByRole( 'button', { name: 'Balanced' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Balanced · High' } ) ).not.toBeInTheDocument();
		await user.clear( search );
		await user.type( search, 'balanced high' );
		expect( screen.queryByRole( 'button', { name: 'Balanced' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Balanced · High' } ) ).toBeVisible();
		await user.keyboard( '{ArrowDown}' );
		expect( screen.getByRole( 'button', { name: 'Balanced · High' } ) ).toHaveFocus();
		await user.keyboard( '{ArrowUp}' );
		expect( search ).toHaveFocus();
		await user.keyboard( '{Enter}' );
		expect( trigger ).toHaveTextContent( 'Balanced · High' );
	} );
	it( 'stars a searched model at the chosen effort without switching models', async () => {
		const { user, connector, trigger, onModelChange } = await setup();
		await user.click( screen.getByRole( 'button', { name: 'Effort: Medium' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'High' } ) );
		const changes = onModelChange.mock.calls.length;
		const search = screen.getByRole( 'textbox', { name: 'Search models' } );
		await user.type( search, 'opus' );
		expect( screen.queryByRole( 'button', { name: /^Effort for / } ) ).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Star Opus 5 · High' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites?.[ 0 ] ).toEqual( {
				provider: 'anthropic-api-key',
				model: 'claude-opus-5',
				effort: 'high',
			} )
		);
		expect( onModelChange ).toHaveBeenCalledTimes( changes );
		expect( trigger ).toHaveTextContent( 'Balanced · High' );
		await user.clear( search );
		expect( screen.getByRole( 'button', { name: 'Opus 5 · High' } ) ).toHaveTextContent( 'High' );
	} );

	it.each( [
		[ 'fast', 'Fast' ],
		[ 'strong', 'Strong' ],
	] as const )( 'disables effort for %s, which cannot honor it', async ( model, label ) => {
		const favorite = { provider: 'wpcom', model, effort: 'default' } as ModelFavorite;
		const { user, onModelChange } = await setup( [ favorite ], model );
		expect( screen.getByRole( 'button', { name: label, pressed: true } ) ).toBeVisible();
		const effort = screen.getByRole( 'button', { name: 'Effort: Unavailable' } );
		expect( effort ).toBeVisible();
		expect( effort ).toBeDisabled();
		await user.click( effort );
		expect( screen.queryByRole( 'menu', { name: 'Effort' } ) ).not.toBeInTheDocument();
		expect( onModelChange ).not.toHaveBeenCalled();
	} );
} );
