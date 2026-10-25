import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarToggle } from '@/features/sidebar/sidebar-toggle';
import { SidebarLayout } from './index';
import type { ReactElement, ReactNode } from 'react';

vi.mock( '@/features/sidebar/sidebar-header', () => ( {
	SidebarHeader: () => null,
} ) );

vi.mock( '@/features/notifications/app-message-cards', () => ( {
	AppMessageCards: () => null,
	AppMessageCardsDot: () => null,
	AppMessageHistoryRecorder: () => null,
} ) );

vi.mock( '@/features/sidebar/collapsed-site-switcher', () => ( {
	CollapsedSiteSwitcher: ( { trigger }: { trigger: ReactElement } ) => trigger,
} ) );

vi.mock( '@/features/sidebar/site-list', () => ( {
	SiteList: ( { onSiteOpen }: { onSiteOpen?: () => void } ) => (
		<button type="button" onClick={ onSiteOpen }>
			A chat
		</button>
	),
	SeenSessionTimestampsProvider: ( { children }: { children: ReactNode } ) => children,
} ) );

vi.mock( '@/features/account/user-menu', () => ( {
	UserMenu: () => <div data-testid="user-menu" />,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/host/use-fullscreen', () => ( {
	useFullscreen: () => false,
} ) );

vi.mock( '@/data/host/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );

describe( 'SidebarLayout', () => {
	let toggleSidebarListener: ( () => void ) | undefined;
	let originalInnerWidth: number;
	beforeEach( () => {
		vi.clearAllMocks();
		window.localStorage.clear();
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
				<SidebarToggle />
			</SidebarLayout>
		);

		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();

		await act( async () => toggleSidebarListener?.() );

		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();

		await act( async () => toggleSidebarListener?.() );

		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the toggle in the panel whether or not the sidebar is collapsed', async () => {
		render(
			<SidebarLayout>
				<SidebarToggle />
			</SidebarLayout>
		);

		expect( screen.getByRole( 'button', { name: 'Hide sidebar' } ) ).toBeInTheDocument();

		await act( async () => toggleSidebarListener?.() );

		expect( screen.queryByRole( 'button', { name: 'Hide sidebar' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();
	} );

	it( 'opens over the content on a small window, and docks again when it widens', async () => {
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 900 } );
		render(
			<SidebarLayout>
				<SidebarToggle />
			</SidebarLayout>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Show sidebar' } ) );
		expect( screen.getByRole( 'button', { name: 'Close sidebar' } ) ).toBeInTheDocument();

		fireEvent.keyDown( window, { key: 'Escape' } );
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();

		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 1024 } );
		await act( async () => window.dispatchEvent( new Event( 'resize' ) ) );
		expect( screen.getByRole( 'button', { name: 'Hide sidebar' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
	} );

	it( 'closes the overlay on a pick, focusing its first item on open and the toggle on close', async () => {
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 900 } );
		render(
			<SidebarLayout>
				<SidebarToggle />
			</SidebarLayout>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Show sidebar' } ) );
		expect( screen.getByRole( 'button', { name: 'A chat' } ) ).toHaveFocus();

		fireEvent.click( screen.getByRole( 'button', { name: 'A chat' } ) );
		expect( screen.queryByRole( 'button', { name: 'Close sidebar' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toHaveFocus();

		fireEvent.click( screen.getByRole( 'button', { name: 'Show sidebar' } ) );
		fireEvent.keyDown( window, { key: 'Escape' } );
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toHaveFocus();
	} );

	it( 'keeps the sidebar collapsed across restarts', async () => {
		const { unmount } = render(
			<SidebarLayout>
				<SidebarToggle />
			</SidebarLayout>
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Hide sidebar' } ) );
		unmount();

		render(
			<SidebarLayout>
				<SidebarToggle />
			</SidebarLayout>
		);
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();
	} );

	it( 'resets the sidebar width when its resize handle is double-clicked', () => {
		Object.defineProperty( window, 'innerWidth', { configurable: true, value: 1600 } );
		render(
			<SidebarLayout>
				<SidebarToggle />
			</SidebarLayout>
		);
		const handle = screen.getByRole( 'separator', { name: 'Resize sidebar' } );

		fireEvent.keyDown( handle, { key: 'End' } );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '400' );
		fireEvent.mouseDown( handle, { detail: 1 } );
		fireEvent.mouseUp( document );
		fireEvent.mouseDown( handle, { detail: 2 } );
		fireEvent.mouseUp( document );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '256' );
	} );
} );
