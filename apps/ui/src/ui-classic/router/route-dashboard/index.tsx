import { createRoute } from '@tanstack/react-router';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useSiteSummaries } from '@/data/queries/use-sites';
import { dashboardLayoutRoute } from '../layout-dashboard';

function DashboardHome() {
	const { data: sites } = useSiteSummaries();
	const count = sites?.length ?? 0;

	return (
		<div style={ { padding: 24 } }>
			<h1>{ __( 'Dashboard' ) }</h1>
			<p>{ sprintf( _n( '%d site', '%d sites', count ), count ) }</p>
		</div>
	);
}

export const dashboardRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/dashboard',
	component: DashboardHome,
} );
