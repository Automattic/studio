import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarToggle } from '@/components/sidebar-toggle';
import { useConnector } from '@/data/core';
import { SidebarLayout } from './index';
import type { ReactElement, ReactNode } from 'react';

vi.mock( '@/components/sidebar-header', () => ( {
	SidebarHeader: () => null,
} ) );

vi.mock( '@/components/app-message-cards', () => ( {
	AppMessageCards: () => null,
	AppMessageCardsDot: () => null,
	AppMessageHistoryRecorder: () => null,
} ) );

vi.mock( '@/components/collapsed-site-switcher', () => ( {
	CollapsedSiteSwitcher: ( { trigger }: { trigger: ReactElement } ) => trigger,
} ) );

vi.mock( '@/components/site-list', () => ( {
	SiteList: () => <div data-testid="site-list" />,
	SeenSessionTimestampsProvider: ( { children }: { children: ReactNode } ) => children,
} ) );

vi.mock( '@/components/user-menu', () => ( {
	UserMenu: () => <div data-testid="user-menu" />,
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
} );
