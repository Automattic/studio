import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarHeader } from './index';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const navigate = vi.fn();
const popupAppMenu = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigate,
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Icon: ( { children }: { children?: ReactNode } ) => <span>{ children }</span>,
	IconButton: ( {
		label,
		icon,
		tone,
		variant,
		size,
		...props
	}: ButtonHTMLAttributes< HTMLButtonElement > & {
		label: string;
		icon?: unknown;
		tone?: string;
		variant?: string;
		size?: string;
	} ) => {
		void icon;
		void tone;
		void variant;
		void size;
		return (
			<button type="button" aria-label={ label } { ...props }>
				{ label }
			</button>
		);
	},
} ) );

vi.mock( '@/components/menu', () => ( {
	Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Trigger: ( { render }: { render: ReactNode } ) => <>{ render }</>,
	Popup: ( { children }: { children: ReactNode } ) => <div role="menu">{ children }</div>,
	Item: ( { children, onClick }: { children: ReactNode; onClick?: () => void } ) => (
		<button type="button" onClick={ onClick }>
			{ children }
		</button>
	),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

// Reaches react-query; the header test has no providers.
vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => ( { start: true, end: false } ),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

describe( 'SidebarHeader', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( { showsAppMenuButton: false, popupAppMenu } );
	} );

	it( 'opens site creation from the top-right create menu', () => {
		render( <SidebarHeader /> );

		expect( screen.getByRole( 'button', { name: 'Create new' } ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add a site' } ) );
		expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding' } );
	} );

	it( 'opens the plugin picker from the create menu', () => {
		render( <SidebarHeader /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add a plugin' } ) );
		expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding/plugin' } );
	} );

	it( 'has no sidebar toggle — it lives in the sidebar footer', () => {
		render( <SidebarHeader /> );

		expect( screen.queryByRole( 'button', { name: 'Hide sidebar' } ) ).not.toBeInTheDocument();
	} );

	it( 'opens the app menu when the host has no native menu bar', () => {
		useConnectorMock.mockReturnValue( { showsAppMenuButton: true, popupAppMenu } );

		render( <SidebarHeader /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Menu' } ) );

		expect( popupAppMenu ).toHaveBeenCalledWith( { x: 0, y: 0 } );
	} );

	it( 'hides the app menu button when the host has a native menu bar', () => {
		useConnectorMock.mockReturnValue( { showsAppMenuButton: false } );

		render( <SidebarHeader /> );

		expect( screen.queryByRole( 'button', { name: 'Menu' } ) ).not.toBeInTheDocument();
	} );
} );
