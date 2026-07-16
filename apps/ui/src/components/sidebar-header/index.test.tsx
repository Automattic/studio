import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarHeader } from './index';

const navigate = vi.fn();
const popupAppMenu = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigate,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => false,
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

describe( 'SidebarHeader', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( { showsAppMenuButton: true, popupAppMenu } );
	} );

	it( 'starts the add-site workflow from the plus button', () => {
		render( <SidebarHeader onToggleSidebar={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding' } );
		expect( screen.queryByText( 'New chat' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Import from…' ) ).not.toBeInTheDocument();
	} );

	it( 'opens the app menu when the host has no native menu bar', () => {
		render( <SidebarHeader onToggleSidebar={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Menu' } ) );

		expect( popupAppMenu ).toHaveBeenCalledWith( { x: 0, y: 0 } );
	} );

	it( 'hides the app menu button when the host has a native menu bar', () => {
		useConnectorMock.mockReturnValue( { showsAppMenuButton: false } );

		render( <SidebarHeader onToggleSidebar={ vi.fn() } /> );

		expect( screen.queryByRole( 'button', { name: 'Menu' } ) ).not.toBeInTheDocument();
	} );
} );
