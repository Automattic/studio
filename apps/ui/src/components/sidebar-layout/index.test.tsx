import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarLayout } from './index';
import type { ReactNode } from 'react';

vi.mock( '@/components/sidebar-header', () => ( {
	SidebarHeader: () => null,
} ) );

vi.mock( '@/components/app-message-cards', () => ( {
	AppMessageCards: () => null,
	AppMessageCardsDot: () => null,
	StudioBetaCard: () => null,
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

vi.mock( '@/hooks/use-fullscreen', () => ( {
	useFullscreen: () => false,
} ) );

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

vi.mock( '@wordpress/ui', async () => {
	const actual = await vi.importActual< typeof import('@wordpress/ui') >( '@wordpress/ui' );
	return {
		...actual,
		IconButton: ( {
			label,
			onClick,
		}: {
			label: string;
			onClick: () => void;
			children?: ReactNode;
		} ) => <button onClick={ onClick }>{ label }</button>,
	};
} );

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

	it( 'hands the sidebar shortcut to the forcing feature while force-collapsed', () => {
		const onForceCollapsedToggle = vi.fn();
		render(
			<SidebarLayout forceCollapsed onForceCollapsedToggle={ onForceCollapsedToggle }>
				<div>Content</div>
			</SidebarLayout>
		);

		// Collapsed (no resize handle), but its own floating toggle stays away —
		// the forcing feature (full preview) owns the exit affordance.
		expect( screen.queryByRole( 'separator', { name: 'Resize sidebar' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();

		act( () => toggleSidebarListener?.() );

		expect( onForceCollapsedToggle ).toHaveBeenCalledTimes( 1 );
	} );
} );
