import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationDot } from '@/lib/ui/notification-dot';
import {
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuActions,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuLabel,
} from '.';

describe( 'Sidebar kit', () => {
	it( 'lists rows as list items, each with its button and actions', () => {
		render(
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton active>
						<SidebarMenuLabel>Bistro</SidebarMenuLabel>
						<NotificationDot position="end" label="Unread" />
					</SidebarMenuButton>
					<SidebarMenuActions showOnHover>
						<button type="button">Pin</button>
					</SidebarMenuActions>
				</SidebarMenuItem>
			</SidebarMenu>
		);
		const [ item ] = screen.getAllByRole( 'listitem' );
		expect( screen.getByRole( 'list' ) ).toContainElement( item );
		const button = screen.getByRole( 'button', { name: 'Bistro Unread' } );
		expect( button ).toHaveAttribute( 'type', 'button' );
		expect( button ).toHaveAttribute( 'data-active' );
		expect( screen.getByRole( 'img', { name: 'Unread' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Pin' } ).parentElement ).toHaveAttribute(
			'data-show-on-hover'
		);
	} );

	it( 'renders a row as another element around its own control', () => {
		const onClick = vi.fn();
		render(
			<SidebarMenuButton render={ <div /> } inset muted onClick={ onClick }>
				<SidebarMenuLabel render={ <button type="button" /> }>Field Notes</SidebarMenuLabel>
			</SidebarMenuButton>
		);
		const label = screen.getByRole( 'button', { name: 'Field Notes' } );
		const row = label.parentElement!;
		expect( row.tagName ).toBe( 'DIV' );
		expect( row ).not.toHaveAttribute( 'type' );
		expect( row ).toHaveAttribute( 'data-inset' );
		expect( row ).toHaveAttribute( 'data-muted' );
		fireEvent.click( label );
		expect( onClick ).toHaveBeenCalled();
	} );

	it( 'folds a group from its label only when the group is foldable', () => {
		const onExpandedChange = vi.fn();
		const { rerender } = render(
			<SidebarGroupLabel expanded onExpandedChange={ onExpandedChange }>
				Sites
			</SidebarGroupLabel>
		);
		const label = screen.getByRole( 'button', { name: 'Sites' } );
		expect( label ).toHaveAttribute( 'aria-expanded', 'true' );
		fireEvent.click( label );
		expect( onExpandedChange ).toHaveBeenCalledWith( false );

		rerender( <SidebarGroupLabel>Needs input</SidebarGroupLabel> );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Needs input' ) ).toBeInTheDocument();
	} );

	it( 'hides an unlabelled dot from assistive technology', () => {
		const { container } = render( <NotificationDot position="icon" /> );
		expect( container.firstChild ).toHaveAttribute( 'aria-hidden', 'true' );
		expect( screen.queryByRole( 'img' ) ).not.toBeInTheDocument();
	} );
} );
