import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarLayout } from './index';

vi.mock( '@/components/sidebar-create-menu', () => ( {
	SidebarCreateMenu: () => null,
} ) );

vi.mock( '@/components/sidebar-header', () => ( {
	SidebarHeader: () => null,
} ) );

vi.mock( '@/components/site-list', () => ( {
	SiteList: () => <nav aria-label="Sites" />,
} ) );

vi.mock( '@/components/user-menu', () => ( {
	UserMenu: ( { onToggleSidebar }: { onToggleSidebar: () => void } ) => (
		<button onClick={ onToggleSidebar }>Hide sidebar</button>
	),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

describe( 'SidebarLayout', () => {
	let toggleSidebarListener: ( () => void ) | undefined;

	beforeEach( () => {
		vi.clearAllMocks();
		toggleSidebarListener = undefined;
		useConnectorMock.mockReturnValue( {
			onToggleSidebar: vi.fn( ( listener ) => {
				toggleSidebarListener = listener;
				return vi.fn();
			} ),
		} );
	} );

	it( 'toggles the sidebar when the connector emits the shortcut command', () => {
		render(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);

		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();

		act( () => toggleSidebarListener?.() );

		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();

		act( () => toggleSidebarListener?.() );

		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();
	} );
} );
