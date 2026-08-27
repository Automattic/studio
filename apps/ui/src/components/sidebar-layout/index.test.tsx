import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarLayout } from './index';
import type { ReactElement, ReactNode } from 'react';

vi.mock( '@/components/sidebar-header', () => ( {
	SidebarHeader: () => null,
} ) );

vi.mock( '@/components/app-message-cards', () => ( {
	AppMessageCards: () => null,
	AppMessageCardsDot: () => null,
} ) );

vi.mock( '@/components/collapsed-site-switcher', () => ( {
	CollapsedSiteSwitcher: ( { trigger }: { trigger: ReactElement } ) => trigger,
} ) );

vi.mock( '@/components/studio-beta-menu', () => ( {
	StudioBetaMenu: () => null,
} ) );

vi.mock( '@/components/site-list', () => ( {
	SiteList: () => <div data-testid="site-list" />,
	SeenSessionTimestampsProvider: ( { children }: { children: ReactNode } ) => children,
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

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

describe( 'SidebarLayout', () => {
	let toggleSidebarListener: ( () => void ) | undefined;
	let originalInnerWidth: number;
	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ResizeObserver', undefined );
		originalInnerWidth = window.innerWidth;
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 1024 } );
		toggleSidebarListener = undefined;
		useConnectorMock.mockReturnValue( {
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
		vi.unstubAllGlobals();
	} );

	it( 'toggles the sidebar when the connector emits the shortcut command', async () => {
		render(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);

		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();

		await act( async () => toggleSidebarListener?.() );

		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();

		await act( async () => toggleSidebarListener?.() );

		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();
	} );

	it( 'hands the sidebar shortcut to the forcing feature while force-collapsed', () => {
		const onForceCollapsedToggle = vi.fn();
		const onExpand = vi.fn();
		render(
			<SidebarLayout
				forceCollapsed
				onExpand={ onExpand }
				onForceCollapsedToggle={ onForceCollapsedToggle }
			>
				<div>Content</div>
			</SidebarLayout>
		);

		// Collapsed (no resize handle), but its own floating toggle stays away —
		// the forcing feature (full preview) owns the exit affordance.
		expect( screen.queryByRole( 'separator', { name: 'Resize sidebar' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();

		act( () => toggleSidebarListener?.() );

		expect( onForceCollapsedToggle ).toHaveBeenCalledTimes( 1 );
		expect( onExpand ).not.toHaveBeenCalled();
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

	it( 'delegates reopening so the parent can coordinate the panels', () => {
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 420 } );
		const onExpand = vi.fn();
		render(
			<SidebarLayout onExpand={ onExpand }>
				<div>Content</div>
			</SidebarLayout>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Show sidebar' } ) );

		expect( onExpand ).toHaveBeenCalledOnce();
	} );

	it( 'observes the rendered layout width while the window is being resized', () => {
		let resizeCallback: ResizeObserverCallback | undefined;
		class ResizeObserverMock {
			constructor( callback: ResizeObserverCallback ) {
				resizeCallback = callback;
			}
			observe() {}
			disconnect() {}
		}
		vi.stubGlobal( 'ResizeObserver', ResizeObserverMock );

		render(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);

		act( () => {
			resizeCallback?.(
				[ { contentRect: { width: 659 } } as unknown as ResizeObserverEntry ],
				{} as ResizeObserver
			);
		} );

		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();
	} );
} );
