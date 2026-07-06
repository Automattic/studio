import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SidebarLayout } from './index';
import type { ReactNode } from 'react';

vi.mock( '@/components/sidebar-header', () => ( {
	SidebarHeader: () => null,
} ) );

vi.mock( '@/components/site-list', () => ( {
	SiteList: () => <nav aria-label="Sites" />,
} ) );

vi.mock( '@/components/user-menu', () => ( {
	UserMenu: ( { onToggleSidebar }: { onToggleSidebar: () => void } ) => (
		<button onClick={ onToggleSidebar }>Hide sidebar</button>
	),
} ) );

// Hits react-query; the layout test has no QueryClientProvider.
vi.mock( '@/components/app-message-cards', () => ( {
	AppMessageCards: () => null,
	AppMessageCardsDot: () => null,
} ) );

// Same: resolves the saved color scheme via useUserPreferences (react-query).
vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
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

	it( 'collapses without a floating toggle while force-collapsed', () => {
		const { rerender } = render(
			<SidebarLayout forceCollapsed>
				<div>Content</div>
			</SidebarLayout>
		);

		// Collapsed: no resize handle — and no floating toggle either, since the
		// forcing feature owns the exit affordance.
		expect( screen.queryByRole( 'separator', { name: 'Resize sidebar' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();

		rerender(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);

		// The user never collapsed it themselves, so it comes back expanded.
		expect( screen.getByRole( 'separator', { name: 'Resize sidebar' } ) ).toBeInTheDocument();
	} );

	it( 'preserves the user-collapsed state across a forced collapse', () => {
		const { rerender } = render(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);

		act( () => toggleSidebarListener?.() );
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();

		rerender(
			<SidebarLayout forceCollapsed>
				<div>Content</div>
			</SidebarLayout>
		);
		expect( screen.queryByRole( 'button', { name: 'Show sidebar' } ) ).not.toBeInTheDocument();

		rerender(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);
		expect( screen.getByRole( 'button', { name: 'Show sidebar' } ) ).toBeInTheDocument();
	} );

	it( 'hands the shortcut toggle to the forcing feature and expands', () => {
		const onForceCollapsedToggle = vi.fn();
		const { rerender } = render(
			<SidebarLayout forceCollapsed onForceCollapsedToggle={ onForceCollapsedToggle }>
				<div>Content</div>
			</SidebarLayout>
		);

		act( () => toggleSidebarListener?.() );

		expect( onForceCollapsedToggle ).toHaveBeenCalledTimes( 1 );

		// Once the forcing feature stands down, the sidebar is expanded — even
		// if the user had collapsed it before.
		rerender(
			<SidebarLayout>
				<div>Content</div>
			</SidebarLayout>
		);
		expect( screen.getByRole( 'separator', { name: 'Resize sidebar' } ) ).toBeInTheDocument();
	} );
} );
