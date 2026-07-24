import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wapuuWorldSlot } from '@/lib/wapuu-world';
import { WapuuWorldMount } from './index';

vi.mock( './wapuu-world-game', () => ( {
	WapuuWorldGame: ( { onClose }: { onClose: () => void } ) => (
		<div role="dialog" aria-label="Wapuu World">
			<button onClick={ onClose }>close</button>
		</div>
	),
} ) );

const KONAMI = [
	'ArrowUp',
	'ArrowUp',
	'ArrowDown',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowLeft',
	'ArrowRight',
	'b',
	'a',
];

function enterKonami() {
	act( () => {
		KONAMI.forEach( ( key ) => window.dispatchEvent( new KeyboardEvent( 'keydown', { key } ) ) );
	} );
}

describe( 'WapuuWorldMount', () => {
	afterEach( () => {
		act( () => wapuuWorldSlot.close() );
	} );

	it( 'renders nothing until the Konami code is entered', () => {
		render( <WapuuWorldMount /> );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'opens the game overlay when the Konami code is entered', () => {
		render( <WapuuWorldMount /> );
		enterKonami();
		expect( screen.getByRole( 'dialog', { name: 'Wapuu World' } ) ).toBeInTheDocument();
	} );

	it( 'closes the overlay when the game requests it', () => {
		render( <WapuuWorldMount /> );
		enterKonami();

		act( () => {
			screen.getByRole( 'button', { name: 'close' } ).click();
		} );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );
} );
