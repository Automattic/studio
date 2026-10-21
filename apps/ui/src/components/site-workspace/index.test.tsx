import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SiteWorkspace } from './index';

vi.mock( '@/components/session-view', () => ( {
	SessionView: ( { sessionId }: { sessionId: string } ) => (
		<div data-testid="chat">Chat { sessionId }</div>
	),
	SignedOutSessionView: ( { siteId }: { siteId: string } ) => (
		<div data-testid="signed-out-chat">Sign in for { siteId }</div>
	),
} ) );

vi.mock( '@/components/site-settings-page', () => ( {
	SiteSettingsPage: ( { siteId, activeTab }: { siteId: string; activeTab: string } ) => (
		<div data-testid="settings">
			Settings { siteId } { activeTab }
		</div>
	),
} ) );

describe( 'SiteWorkspace', () => {
	it( 'renders the signed-out chat surface without creating a session', () => {
		render(
			<SiteWorkspace
				siteId="site-1"
				activeView="chat"
				settingsTab="general"
				onSettingsTabChange={ vi.fn() }
			/>
		);

		expect( screen.getByTestId( 'signed-out-chat' ) ).toHaveTextContent( 'Sign in for site-1' );
		expect( screen.queryByTestId( 'chat' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps chat and settings mounted while switching the active layer', () => {
		const onSettingsTabChange = vi.fn();
		const { rerender } = render(
			<SiteWorkspace
				siteId="site-1"
				activeView="chat"
				sessionId="session-1"
				settingsTab="general"
				onSettingsTabChange={ onSettingsTabChange }
			/>
		);

		const chat = screen.getByTestId( 'chat' );
		expect( screen.queryByTestId( 'settings' ) ).not.toBeInTheDocument();
		expect( chat.parentElement ).not.toHaveAttribute( 'aria-hidden' );

		rerender(
			<SiteWorkspace
				siteId="site-1"
				activeView="settings"
				settingsTab="general"
				onSettingsTabChange={ onSettingsTabChange }
			/>
		);

		const settings = screen.getByTestId( 'settings' );
		expect( screen.getByTestId( 'chat' ) ).toBe( chat );
		expect( chat.parentElement ).toHaveAttribute( 'aria-hidden', 'true' );
		expect( chat.parentElement ).toHaveAttribute( 'inert' );
		expect( settings.parentElement ).not.toHaveAttribute( 'aria-hidden' );

		rerender(
			<SiteWorkspace
				siteId="site-1"
				activeView="chat"
				sessionId="session-1"
				settingsTab="general"
				onSettingsTabChange={ onSettingsTabChange }
			/>
		);

		expect( screen.getByTestId( 'chat' ) ).toBe( chat );
		expect( screen.getByTestId( 'settings' ) ).toBe( settings );
		expect( chat.parentElement ).not.toHaveAttribute( 'aria-hidden' );
		expect( settings.parentElement ).toHaveAttribute( 'aria-hidden', 'true' );
		expect( settings.parentElement ).toHaveAttribute( 'inert' );
	} );

	it( 'keeps the last settings tab while chat is active', () => {
		const onSettingsTabChange = vi.fn();
		const { rerender } = render(
			<SiteWorkspace
				siteId="site-1"
				activeView="settings"
				settingsTab="debugging"
				onSettingsTabChange={ onSettingsTabChange }
			/>
		);

		rerender(
			<SiteWorkspace
				siteId="site-1"
				activeView="chat"
				sessionId="session-1"
				settingsTab="general"
				onSettingsTabChange={ onSettingsTabChange }
			/>
		);

		expect( screen.getByTestId( 'settings' ) ).toHaveTextContent( 'debugging' );
	} );
} );
