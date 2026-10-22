import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarSettings } from './sidebar-settings';

const save = vi.hoisted( () => vi.fn() );

vi.mock( '@/data/queries/use-sidebar-pins', () => ( {
	useSidebarPreferences: () => ( { showRecentChats: true, autoCollapseSites: true, save } ),
} ) );

describe( 'SidebarSettings', () => {
	it( 'saves the sidebar preferences as they are switched', () => {
		render( <SidebarSettings /> );

		fireEvent.click( screen.getByRole( 'switch', { name: 'Show recent chats' } ) );
		expect( save ).toHaveBeenLastCalledWith( { showRecentChats: false } );
		fireEvent.click( screen.getByRole( 'switch', { name: 'Collapse sidebar groups' } ) );
		expect( save ).toHaveBeenLastCalledWith( { autoCollapseSites: false } );
	} );
} );
