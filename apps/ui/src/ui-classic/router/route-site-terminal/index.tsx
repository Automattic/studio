import { createRoute } from '@tanstack/react-router';
import { ClaudeTerminal } from '@/components/claude-terminal';
import { dashboardLayoutRoute } from '../layout-dashboard';

function SiteTerminalPage() {
	const { siteId } = siteTerminalRoute.useParams();
	return <ClaudeTerminal siteId={ siteId } />;
}

export const siteTerminalRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId/terminal',
	component: SiteTerminalPage,
} );
