import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useScrollFade } from './use-scroll-fade';

function ScrollArea( { inset = false }: { inset?: boolean } ) {
	const ref = useScrollFade< HTMLDivElement >( { inset } );
	return (
		<div
			ref={ ref }
			role="region"
			aria-label="Content"
			style={ { paddingTop: 52, paddingBottom: 120 } }
		>
			<p>Content</p>
		</div>
	);
}

function setScroll( node: HTMLElement, top: number, height = 1000 ) {
	Object.defineProperties( node, {
		scrollHeight: { configurable: true, value: height },
		clientHeight: { configurable: true, value: 400 },
		scrollTop: { configurable: true, value: top },
	} );
	fireEvent.scroll( node );
}

const fade = ( node: HTMLElement, edge: string ) =>
	node.style.getPropertyValue( `--scroll-fade-${ edge }` );

describe( 'scroll fades', () => {
	it( 'leaves short content clear and fades only overflowing edges', async () => {
		render( <ScrollArea /> );
		const node = screen.getByRole( 'region', { name: 'Content' } );
		setScroll( node, 0, 300 );
		await waitFor( () => expect( fade( node, 'bottom' ) ).toBe( '0px' ) );
		expect( fade( node, 'top' ) ).toBe( '0px' );
		expect( node ).not.toHaveAttribute( 'data-scroll-bottom' );
		setScroll( node, 0 );
		await waitFor( () => expect( node ).toHaveAttribute( 'data-scroll-bottom' ) );
		expect( fade( node, 'top' ) ).toBe( '0px' );
		setScroll( node, 300 );
		await waitFor( () => expect( fade( node, 'top' ) ).toBe( '24px' ) );
		expect( fade( node, 'bottom' ) ).toBe( '24px' );
		setScroll( node, 600 );
		await waitFor( () => expect( fade( node, 'bottom' ) ).toBe( '0px' ) );
		expect( node ).not.toHaveAttribute( 'data-scroll-bottom' );
	} );

	it( 'keeps content behind fixed chrome and releases the bottom fade at the final message', async () => {
		render( <ScrollArea inset /> );
		const node = screen.getByRole( 'region', { name: 'Content' } );
		setScroll( node, 300 );
		await waitFor( () => expect( fade( node, 'top' ) ).toBe( '52px' ) );
		expect( fade( node, 'top-inset' ) ).toBe( '0px' );
		expect( fade( node, 'bottom' ) ).toBe( '144px' );
		expect( fade( node, 'bottom-inset' ) ).toBe( '120px' );
		setScroll( node, 600 );
		await waitFor( () => expect( fade( node, 'bottom' ) ).toBe( '120px' ) );
		expect( node ).not.toHaveAttribute( 'data-scroll-bottom' );
	} );
} );
