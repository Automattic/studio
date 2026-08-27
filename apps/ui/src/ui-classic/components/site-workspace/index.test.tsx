import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SiteWorkspace } from './index';

vi.mock( '@/ui-classic/components/session-view', () => ( {
	SessionView: ( { sessionId }: { sessionId: string } ) => (
		<div data-testid="chat">Chat { sessionId }</div>
	),
} ) );

vi.mock( '@/components/site-overview-view', () => ( {
	SiteOverviewView: ( {
		siteId,
		activeTab,
		onTabChange,
	}: {
		siteId: string;
		activeTab: string;
		onTabChange: ( tab: 'general' ) => void;
	} ) => (
		<div data-testid="overview">
			Overview { siteId } { activeTab }
			<button type="button" onClick={ () => onTabChange( 'general' ) }>
				Open general
			</button>
		</div>
	),
} ) );

describe( 'SiteWorkspace', () => {
	it( 'keeps chat and overview mounted while switching the active layer', () => {
		const onOverviewTabChange = vi.fn();
		const { rerender } = render(
			<SiteWorkspace
				siteId="site-1"
				activeView="chat"
				sessionId="session-1"
				overviewTab="overview"
				onOverviewTabChange={ onOverviewTabChange }
			/>
		);

		const chat = screen.getByTestId( 'chat' );
		expect( screen.queryByTestId( 'overview' ) ).not.toBeInTheDocument();
		expect( chat.parentElement ).not.toHaveAttribute( 'aria-hidden' );

		rerender(
			<SiteWorkspace
				siteId="site-1"
				activeView="overview"
				overviewTab="overview"
				onOverviewTabChange={ onOverviewTabChange }
			/>
		);

		const overview = screen.getByTestId( 'overview' );
		expect( screen.getByTestId( 'chat' ) ).toBe( chat );
		expect( chat.parentElement ).toHaveAttribute( 'aria-hidden', 'true' );
		expect( chat.parentElement ).toHaveAttribute( 'inert' );
		expect( overview.parentElement ).not.toHaveAttribute( 'aria-hidden' );

		rerender(
			<SiteWorkspace
				siteId="site-1"
				activeView="chat"
				sessionId="session-1"
				overviewTab="overview"
				onOverviewTabChange={ onOverviewTabChange }
			/>
		);

		expect( screen.getByTestId( 'chat' ) ).toBe( chat );
		expect( screen.getByTestId( 'overview' ) ).toBe( overview );
		expect( chat.parentElement ).not.toHaveAttribute( 'aria-hidden' );
		expect( overview.parentElement ).toHaveAttribute( 'aria-hidden', 'true' );
		expect( overview.parentElement ).toHaveAttribute( 'inert' );
	} );

	it( 'keeps the last overview tab while chat is active', () => {
		const onOverviewTabChange = vi.fn();
		const { rerender } = render(
			<SiteWorkspace
				siteId="site-1"
				activeView="overview"
				overviewTab="general"
				onOverviewTabChange={ onOverviewTabChange }
			/>
		);

		rerender(
			<SiteWorkspace
				siteId="site-1"
				activeView="chat"
				sessionId="session-1"
				overviewTab="overview"
				onOverviewTabChange={ onOverviewTabChange }
			/>
		);

		expect( screen.getByTestId( 'overview' ) ).toHaveTextContent( 'general' );
	} );
} );
