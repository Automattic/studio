import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarHeader } from './index';

const navigate = vi.fn();
const popupAppMenu = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigate,
} ) );

vi.mock( '@/components/menu', () => {
	const el = ( props: Record< string, unknown > ) => {
		const { children, render: trigger, onClick, disabled } = props;
		if ( trigger ) return trigger;
		if ( onClick ) {
			return (
				<button type="button" onClick={ onClick as () => void } disabled={ !! disabled }>
					{ children as never }
				</button>
			);
		}
		return <div>{ children as never }</div>;
	};
	return { Root: el, Trigger: el, Popup: el, Item: el };
} );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn( () => ( { enabled: true, reason: null, isReady: true } ) ),
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

	it( 'shows a create menu with New chat, New site, and Import options', async () => {
		render( <SidebarHeader onToggleSidebar={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Create new' } ) );

		expect( await screen.findByText( 'New chat' ) ).toBeInTheDocument();
		expect( screen.getByText( 'New site' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Import from…' ) ).toBeInTheDocument();
	} );

	it( 'hides the sidebar from the header toggle', () => {
		const onToggleSidebar = vi.fn();
		render( <SidebarHeader onToggleSidebar={ onToggleSidebar } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Hide sidebar' } ) );

		expect( onToggleSidebar ).toHaveBeenCalledTimes( 1 );
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
