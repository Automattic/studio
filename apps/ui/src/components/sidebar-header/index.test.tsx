import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarHeader } from './index';

const navigate = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigate,
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => false,
} ) );

describe( 'SidebarHeader', () => {
	it( 'starts the add-site workflow from the plus button', () => {
		render( <SidebarHeader onToggleSidebar={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding' } );
		expect( screen.queryByText( 'New chat' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Import from…' ) ).not.toBeInTheDocument();
	} );
} );
