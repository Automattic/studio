import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { WordPressDataProvider } from '@/data/wordpress/provider';
import { Desk } from '@/ui-desks/desk';
import { dashboardLayoutRoute } from '../layout-dashboard';
import styles from '../route-desk/style.module.css';

function SiteDeskPage() {
	const { siteId } = siteDeskRoute.useParams();

	return (
		<section
			className={ styles.root }
			data-ui-mode="desks"
			aria-label={ __( 'Desk' ) }
			data-testid="studio-2-site-desk-view"
		>
			<WordPressDataProvider key={ siteId } siteId={ siteId }>
				<Desk siteId={ siteId } embedded />
			</WordPressDataProvider>
		</section>
	);
}

export const siteDeskRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites/$siteId',
	component: SiteDeskPage,
} );
