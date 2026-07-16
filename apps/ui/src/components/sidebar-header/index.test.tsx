import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarHeader } from './index';

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => vi.fn(),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => false,
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

describe( 'SidebarHeader', () => {
	it( 'shows the app menu button when the host has no native menu bar', () => {
		useConnectorMock.mockReturnValue( { showsAppMenuButton: true, popupAppMenu: vi.fn() } );

		render( <SidebarHeader onToggleSidebar={ () => {} } /> );

		expect( screen.getByRole( 'button', { name: 'Menu' } ) ).toBeInTheDocument();
	} );

	it( 'hides the app menu button when the host has a native menu bar', () => {
		useConnectorMock.mockReturnValue( { showsAppMenuButton: false } );

		render( <SidebarHeader onToggleSidebar={ () => {} } /> );

		expect( screen.queryByRole( 'button', { name: 'Menu' } ) ).not.toBeInTheDocument();
	} );
} );
