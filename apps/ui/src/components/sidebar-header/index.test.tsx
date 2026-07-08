import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarHeader } from './index';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const navigate = vi.fn();

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

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		popupAppMenu: vi.fn(),
	} ),
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

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: () => true,
} ) );

describe( 'SidebarHeader', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'opens site creation routes from the top-right create menu', () => {
		render( <SidebarHeader onToggleSidebar={ vi.fn() } /> );

		expect( screen.getByRole( 'button', { name: 'Create new' } ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'New site' } ) );
		expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding' } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Import from…' } ) );
		expect( navigate ).toHaveBeenCalledWith( { to: '/onboarding/import' } );
	} );

	it( 'hides the sidebar from the header toggle', () => {
		const onToggleSidebar = vi.fn();
		render( <SidebarHeader onToggleSidebar={ onToggleSidebar } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Hide sidebar' } ) );

		expect( onToggleSidebar ).toHaveBeenCalledTimes( 1 );
	} );
} );
