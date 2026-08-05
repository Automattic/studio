import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessions } from '@/data/queries/use-sessions';
import styles from './style.module.css';
import { SiteWorkspaceShell } from './index';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const navigateMock = vi.fn();
const useSidebarCollapsedMock = vi.hoisted( () => vi.fn() );
const useTrafficLightSpaceMock = vi.hoisted( () => vi.fn() );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/components/site-toolbar', () => ( {
	SiteToolbar: ( { site }: { site: SiteDetails } ) => <div>{ site.name }</div>,
} ) );

vi.mock( '@/data/queries/use-sessions', () => ( {
	useSessions: vi.fn(),
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: useSidebarCollapsedMock,
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: useTrafficLightSpaceMock,
} ) );

const useSessionsMock = vi.mocked( useSessions, { partial: true } );

class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

const SITE = {
	id: 'site-1',
	name: 'Demo Site',
	path: '/Users/example/Studio/demo-site',
	port: 8881,
	running: false,
	phpVersion: '8.4',
} as SiteDetails;

function createSession( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'chat-1',
		ownerSitePath: SITE.path,
		updatedAt: '2026-08-01T12:00:00.000Z',
		archived: false,
		...overrides,
	} as AiSessionSummary;
}

describe( 'SiteWorkspaceShell', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ResizeObserver', ResizeObserverMock );
		useSessionsMock.mockReturnValue( { data: [], isLoading: false } );
		useSidebarCollapsedMock.mockReturnValue( false );
		useTrafficLightSpaceMock.mockReturnValue( { start: false, end: false } );
	} );

	it( 'keeps one tab strip mounted while the active route changes', () => {
		const { rerender } = render(
			<SiteWorkspaceShell site={ SITE } activeTab="chat" showChat>
				<div>Chat content</div>
			</SiteWorkspaceShell>
		);
		const chatTab = screen.getByRole( 'tab', { name: 'Chat' } );
		const connectionsTab = screen.getByRole( 'tab', { name: 'Connections' } );

		expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
			'Chat',
			'Overview',
			'Connections',
			'Settings',
		] );
		expect( chatTab ).toHaveAttribute( 'aria-selected', 'true' );

		rerender(
			<SiteWorkspaceShell site={ SITE } activeTab="connections" showChat>
				<div>Connections content</div>
			</SiteWorkspaceShell>
		);

		expect( screen.getByRole( 'tab', { name: 'Chat' } ) ).toBe( chatTab );
		expect( screen.getByRole( 'tab', { name: 'Connections' } ) ).toBe( connectionsTab );
		expect( connectionsTab ).toHaveAttribute( 'aria-selected', 'true' );
	} );

	it( 'owns navigation to the latest chat and site tabs', () => {
		useSessionsMock.mockReturnValue( {
			data: [
				createSession( { id: 'older-chat' } ),
				createSession( { id: 'latest-chat', updatedAt: '2026-08-02T12:00:00.000Z' } ),
			],
			isLoading: false,
		} );
		render( <SiteWorkspaceShell site={ SITE } activeTab="connections" showChat /> );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Chat' } ) );
		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sessions/$sessionId',
			params: { sessionId: 'latest-chat' },
		} );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Overview' } ) );
		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/overview',
			params: { siteId: SITE.id },
			replace: true,
		} );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Settings' } ) );
		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/overview',
			params: { siteId: SITE.id },
			search: { tab: 'general' },
			replace: true,
		} );
	} );

	it( 'shows Overview as the site home when chat is unavailable', () => {
		render( <SiteWorkspaceShell site={ SITE } activeTab="overview" showChat={ false } /> );

		expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
			'Overview',
			'Connections',
			'Settings',
		] );
		expect( screen.getByRole( 'tab', { name: 'Overview' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
	} );

	it( 'navigates back to Overview when chat is unavailable', () => {
		render( <SiteWorkspaceShell site={ SITE } activeTab="general" showChat={ false } /> );

		fireEvent.click( screen.getByRole( 'tab', { name: 'Overview' } ) );
		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/overview',
			params: { siteId: SITE.id },
			replace: true,
		} );
	} );

	it( 'reserves traffic-light space once for the persistent header', () => {
		useSidebarCollapsedMock.mockReturnValue( true );
		useTrafficLightSpaceMock.mockReturnValue( { start: true, end: false } );

		render( <SiteWorkspaceShell site={ SITE } activeTab="chat" showChat /> );

		expect( screen.getByText( SITE.name ).parentElement ).toHaveClass(
			styles.headerSidebarCollapsed
		);
	} );
} );
