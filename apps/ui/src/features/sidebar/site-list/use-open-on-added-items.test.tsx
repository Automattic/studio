import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SidebarGroup } from './sidebar-group';

function Group( { keys }: { keys?: string[] } ) {
	return (
		<SidebarGroup id="test" title="Sites" itemKeys={ keys }>
			{ keys?.join( ',' ) }
		</SidebarGroup>
	);
}

const toggle = () => screen.getByRole( 'button', { name: 'Sites' } );

beforeEach( () => localStorage.clear() );

describe( 'opening a group on added items', () => {
	it( 'preserves the initial collapse preference until an item is added', () => {
		localStorage.setItem( 'studio-ui-sidebar-group-test', 'false' );
		const { rerender } = render( <Group /> );
		rerender( <Group keys={ [ 'one', 'two' ] } /> );
		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'false' );
		rerender( <Group keys={ [ 'two', 'one' ] } /> );
		rerender( <Group keys={ [ 'two' ] } /> );
		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'false' );
		rerender( <Group keys={ [ 'three' ] } /> );
		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'true' );
		rerender( <Group keys={ [ 'three' ] } /> );
		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'true' );
	} );

	it( 'does not reopen a group after the user collapses it', () => {
		const { rerender } = render( <Group keys={ [ 'one' ] } /> );
		rerender( <Group keys={ [ 'one', 'two' ] } /> );
		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'true' );
		fireEvent.click( toggle() );
		rerender( <Group keys={ [ 'one', 'two' ] } /> );
		expect( toggle() ).toHaveAttribute( 'aria-expanded', 'false' );
	} );
} );
