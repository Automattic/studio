import { createRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import {
	isSettingsTab,
	SettingsLayout,
	type SettingsTabId,
} from '@/components/settings-view/settings-layout';
import { dashboardLayoutRoute } from '../layout-dashboard';

function deriveActiveTab( pathname: string ): SettingsTabId {
	// The shell renders an <Outlet />, so the only signal for which tab is
	// active is the URL itself — each tab is its own child route.
	const segment = pathname.split( '/' ).filter( Boolean ).at( -1 );
	return segment && isSettingsTab( segment ) ? segment : 'preferences';
}

function SettingsShell() {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const activeTab = deriveActiveTab( pathname );
	return (
		<SettingsLayout
			activeTab={ activeTab }
			onTabChange={ ( next ) => {
				void navigate( { to: `/settings/${ next }` } );
			} }
		>
			<Outlet />
		</SettingsLayout>
	);
}

export const settingsLayoutRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	id: 'settings-layout',
	component: SettingsShell,
} );
