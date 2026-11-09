import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { displayShortcut } from '@wordpress/keycodes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '@/features/composer';
import { clearComposerDrafts } from '@/features/composer/draft-store';
import { Dialog, DialogContent, DialogTitle } from '@/lib/ui';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { AiModelId } from '@studio/agent/protocol/models';
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

function dragFixture() {
	const list = within( screen.getByRole( 'group', { name: 'Favorite models' } ) ).getByRole(
		'list'
	);
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
	{ busy = false, purchasedRemaining = 500 } = {}
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
		const { user, connector, onModelChange } = await setup();
		const high = screen.getByRole( 'button', { name: 'Balanced · High' } );
		const firstShortcut = screen
			.getByRole( 'button', { name: 'Balanced' } )
			.getAttribute( 'aria-keyshortcuts' );
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Reorder Balanced · High' } ), {
			key: 'ArrowUp',
		} );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites?.[ 0 ] ).toEqual( favorites[ 1 ] )
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

	it( 'selects a model and effort together without losing the draft', async () => {
		const { user, onSend, trigger } = await setup();
		expect( screen.queryByText( 'Favorites', { exact: true } ) ).not.toBeInTheDocument();
		await user.click(
			within( screen.getByRole( 'group', { name: 'Favorite models' } ) ).getByRole( 'button', {
				name: 'Balanced · High',
			} )
		);
		expect( trigger ).toHaveTextContent( 'Balanced · High' );
		const input = screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await user.type( input, 'Keep my draft' );
		await user.click( trigger );
		await user.click( screen.getByRole( 'button', { name: 'Effort: High' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'Low' } ) );
		expect( input ).toHaveValue( 'Keep my draft' );
		await user.keyboard( '{Escape}' );
		await user.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( onSend ).toHaveBeenCalledWith(
			'Keep my draft',
			expect.objectContaining( { model: 'balanced', effort: 'low' } )
		);
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

	it( 'reorders favorites from the keyboard and keeps unavailable saved models', async () => {
		const unavailable = {
			provider: 'future-provider',
			model: 'future-model',
			effort: 'default',
		} as ModelFavorite;
		const { connector } = await setup( [ ...favorites, unavailable ] );
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
		expect( screen.getByRole( 'status' ) ).toHaveTextContent(
			'Balanced · High moved to position 1 of 3'
		);
	} );

	it( 'saves a pointer drag without selecting a model', async () => {
		const { connector, onModelChange } = await setup();
		const { list, pointer, handle } = dragFixture();
		fireEvent( handle, pointer( 'pointerdown', 16 ) );
		fireEvent( list, pointer( 'pointermove', 48 ) );
		expect( document.querySelector( '[data-reorder-preview]' ) ).toHaveStyle(
			'inset-block-start: 32px; inset-inline-start: 0'
		);
		expect( list.children[ 0 ] ).toHaveAttribute( 'data-drag-source', 'true' );
		expect( list.children[ 1 ] ).toHaveAttribute( 'data-drop-position', 'after' );
		expect( list.children[ 1 ] ).not.toHaveAttribute( 'style' );
		expect( connector.state.preferences.modelFavorites ).toEqual( favorites );
		fireEvent( list, pointer( 'pointerup', 48 ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toEqual( [
				favorites[ 1 ],
				favorites[ 0 ],
				favorites[ 2 ],
			] )
		);
		expect( onModelChange ).not.toHaveBeenCalled();
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
		await user.click( screen.getByRole( 'button', { name: 'Balanced · High' } ) );
		expect( onModelChange ).toHaveBeenCalledWith( 'balanced', 'wpcom' );
	} );

	it.each( [ 'escape', 'pointercancel', 'blur', 'resize' ] )(
		'cancels a drag on %s without saving or swallowing the next selection',
		async ( reason ) => {
			const { connector, user, onModelChange } = await setup();
			const { list, pointer, handle } = dragFixture();
			fireEvent( handle, pointer( 'pointerdown', 16 ) );
			fireEvent( list, pointer( 'pointermove', 48 ) );
			if ( reason === 'escape' ) fireEvent.keyDown( handle, { key: 'Escape' } );
			else if ( reason === 'blur' ) fireEvent.blur( window );
			else if ( reason === 'resize' ) fireEvent.resize( window );
			else fireEvent( list, pointer( reason, 48 ) );
			fireEvent( list, pointer( 'pointerup', 48 ) );
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

	it( 'ignores child capture loss and a second pointer during a drag', async () => {
		const { connector } = await setup();
		const { list, pointer, handle } = dragFixture();
		fireEvent( handle, pointer( 'pointerdown', 16 ) );
		fireEvent( handle, pointer( 'lostpointercapture', 16 ) );
		fireEvent( list, pointer( 'pointermove', 48, 2 ) );
		expect( document.querySelector( '[data-reorder-preview]' ) ).not.toBeInTheDocument();
		fireEvent( list, pointer( 'pointermove', 48 ) );
		fireEvent( list, pointer( 'pointercancel', 48, 2 ) );
		expect( document.querySelector( '[data-reorder-preview]' ) ).toBeInTheDocument();
		fireEvent( list, pointer( 'pointerup', 48 ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites?.[ 0 ] ).toEqual( favorites[ 1 ] )
		);
	} );

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

	it( 'scrolls near the list edge and moves the drop target with the content', async () => {
		const { connector } = await setup();
		const { list, pointer, handle } = dragFixture();
		const scroller = list.parentElement!.parentElement!;
		scroller.style.overflowY = 'auto';
		vi.spyOn( scroller, 'getBoundingClientRect' ).mockReturnValue( new DOMRect( 0, 0, 224, 64 ) );
		Object.defineProperty( scroller, 'scrollHeight', { value: 96, configurable: true } );
		Object.defineProperty( scroller, 'clientHeight', { value: 64, configurable: true } );
		let scrollTop = 0;
		Object.defineProperty( scroller, 'scrollTop', {
			get: () => scrollTop,
			set: ( value ) => {
				scrollTop = Math.max( 0, Math.min( 32, value ) );
			},
			configurable: true,
		} );
		let frame: FrameRequestCallback | undefined;
		vi.spyOn( window, 'requestAnimationFrame' ).mockImplementation( ( callback ) => {
			frame = callback;
			return 1;
		} );
		vi.spyOn( window, 'cancelAnimationFrame' ).mockImplementation( () => {} );
		fireEvent( handle, pointer( 'pointerdown', 16 ) );
		fireEvent( list, pointer( 'pointermove', 78 ) );
		act( () => frame?.( 16 ) );
		expect( scrollTop ).toBeGreaterThan( 0 );
		expect( list.children[ 2 ] ).toHaveAttribute( 'data-drop-position', 'after' );
		fireEvent( list, pointer( 'pointercancel', 62 ) );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
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

	it( 'searches all models and favorites a result without selecting it', async () => {
		const { user, onModelChange, connector } = await setup();
		const search = screen.getByRole( 'textbox', { name: 'Search models' } );
		await waitFor( () => expect( search ).toHaveFocus() );
		await user.type( search, 'opus' );
		expect( screen.getByRole( 'button', { name: 'Opus 5' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Fast' } ) ).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'button', { name: 'Star Opus 5' } ) );
		await waitFor( () =>
			expect( connector.state.preferences.modelFavorites ).toContainEqual( {
				provider: 'anthropic-api-key',
				model: 'claude-opus-5',
				effort: 'default',
			} )
		);
		expect( onModelChange ).not.toHaveBeenCalled();
		expect( connector.state.preferences.modelFavorites?.[ 0 ] ).toEqual( {
			provider: 'anthropic-api-key',
			model: 'claude-opus-5',
			effort: 'default',
		} );
		await user.clear( search );
		await user.type( search, 'no matching model' );
		expect( screen.getByText( 'No matching models.' ) ).toBeVisible();
		await user.clear( search );
		expect( screen.getByRole( 'group', { name: 'Favorite models' } ) ).toHaveTextContent(
			'Opus 5'
		);
	} );
	it( 'removes even the current and last starred model from the default list', async () => {
		const { user, connector } = await setup( [ favorites[ 0 ] ] );
		await user.click( screen.getByRole( 'button', { name: 'Unstar Balanced' } ) );
		expect( screen.queryByRole( 'button', { name: 'Balanced' } ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Star models to keep them here.' ) ).toBeVisible();
		await waitFor( () => expect( connector.state.preferences.modelFavorites ).toEqual( [] ) );
		await user.type( screen.getByRole( 'textbox', { name: 'Search models' } ), 'balanced' );
		expect( screen.getByRole( 'button', { name: 'Balanced' } ) ).toBeVisible();
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

	it( 'changes effort from one footer control without rewriting saved presets', async () => {
		const saved = [ favorites[ 0 ], favorites[ 2 ] ];
		const { user, connector, trigger, onModelChange } = await setup( saved );
		expect( screen.getAllByRole( 'button', { name: /^Effort:/ } ) ).toHaveLength( 1 );
		await user.click( screen.getByRole( 'button', { name: 'Effort: Medium' } ) );
		expect( await screen.findByRole( 'menuitemradio', { name: 'Medium' } ) ).toBeChecked();
		expect( screen.getAllByRole( 'menuitemradio' ) ).toHaveLength( 3 );
		expect( screen.queryByRole( 'menuitemradio', { name: 'Default' } ) ).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'menuitemradio', { name: 'Medium' } ) );
		expect( onModelChange ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: 'Effort: Medium' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'High' } ) );
		expect( trigger ).toHaveTextContent( 'Balanced · High' );
		expect( screen.getByRole( 'button', { name: 'Effort: High' } ) ).toBeVisible();
		expect( connector.state.preferences.modelFavorites ).toEqual( saved );
		expect( screen.getByRole( 'button', { name: 'Sonnet 5' } ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Effort: High' } ) );
		await user.click( await screen.findByRole( 'menuitemradio', { name: 'Medium' } ) );
		expect( screen.getByRole( 'button', { name: 'Balanced', pressed: true } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Effort: Medium' } ) ).toBeVisible();
		expect( connector.state.preferences.modelFavorites ).toEqual( saved );
	} );

	it( 'marks the active preset in the list without a duplicate current section', async () => {
		const { user, trigger } = await setup();
		const current = screen.getByRole( 'button', { name: 'Balanced', pressed: true } );
		expect( current ).toBeVisible();
		expect( current ).toHaveAttribute( 'aria-keyshortcuts' );
		expect(
			within( current ).queryByText( displayShortcut.primaryAlt( '1' ) )
		).not.toBeInTheDocument();
		expect(
			within( screen.getByRole( 'button', { name: 'Balanced · High' } ) ).getByText(
				displayShortcut.primaryAlt( '2' )
			)
		).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Balanced · High' } ) );
		await user.click( trigger );
		const next = screen.getByRole( 'button', { name: 'Balanced · High', pressed: true } );
		expect( next ).toBeVisible();
		expect( next ).toHaveAttribute( 'aria-keyshortcuts' );
		expect(
			within( next ).queryByText( displayShortcut.primaryAlt( '2' ) )
		).not.toBeInTheDocument();
		expect(
			within( screen.getByRole( 'button', { name: 'Balanced', pressed: false } ) ).getByText(
				displayShortcut.primaryAlt( '1' )
			)
		).toBeVisible();
		expect( screen.queryByRole( 'group', { name: 'Current model' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Current', { exact: true } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps effort available when the search has no matches', async () => {
		const { user } = await setup();
		await user.type( screen.getByRole( 'textbox', { name: 'Search models' } ), 'not a model' );
		expect( screen.getByText( 'No matching models.' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Effort: Medium' } ) ).toBeVisible();
		expect( screen.queryByRole( 'group', { name: 'Current model' } ) ).not.toBeInTheDocument();
	} );

	it.each( [
		[ 'fast', 'Fast' ],
		[ 'strong', 'Strong' ],
	] as const )( 'omits effort for %s, which cannot honor it', async ( model, label ) => {
		const favorite = { provider: 'wpcom', model, effort: 'default' } as ModelFavorite;
		await setup( [ favorite ], model );
		expect( screen.getByRole( 'button', { name: label, pressed: true } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: /^Effort:/ } ) ).not.toBeInTheDocument();
	} );
} );
