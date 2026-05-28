import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Desk } from '@/ui-desks/desk';
import { dashboardLayoutRoute } from '../layout-dashboard';
import styles from './style.module.css';

function DeskPage() {
	return (
		<section
			className={ styles.root }
			data-ui-mode="desks"
			aria-label={ __( 'Desk' ) }
			data-testid="studio-2-desk-view"
		>
			<Desk embedded />
		</section>
	);
}

export const deskRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/desk',
	component: DeskPage,
} );
