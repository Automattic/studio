import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarLayout } from './index';
import type { ReactNode } from 'react';

vi.mock( '@/components/sidebar-header', () => ( {
	SidebarHeader: () => null,
} ) );

vi.mock( '@/components/app-message-cards', () => ( {
	AppMessageCards: () => null,
	AppMessageCardsDot: () => null,
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
	let originalInnerWidth: number;
	const ensureWindowWidth = vi.fn().mockResolvedValue( undefined );

	beforeEach( () => {
		vi.clearAllMocks();
		originalInnerWidth = window.innerWidth;
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 1024 } );
		toggleSidebarListener = undefined;
		useConnectorMock.mockReturnValue( {
			ensureWindowWidth,
			onToggleSidebar: vi.fn( ( listener ) => {
				toggleSidebarListener = listener;
				return vi.fn();
			} ),
		} );
	} );

	afterEach( () => {
		Object.defineProperty( window, 'innerWidth', {
			configurable: true,
			value: originalInnerWidth,
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

	it( 'collapses when the window enters compact width', async () => {
		render(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);

		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 659 } );
		await act( async () => window.dispatchEvent( new Event( 'resize' ) ) );

		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();
	} );

	it( 'starts collapsed in a compact window', () => {
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 420 } );

		render(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);

		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();
	} );

	it( 'grows a compact window when reopening the sidebar', () => {
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 420 } );
		render(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Show sidebar' } ) );

		expect( ensureWindowWidth ).toHaveBeenCalledWith( 660 );
	} );
} );
