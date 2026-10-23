import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { useSites } from '@/data/queries/use-sites';
import { useOpenAddSite } from '@/hooks/use-open-add-site';
import { PlusIcon } from '@/lib/icons/plus-icon';
import { dashboardLayoutRoute } from '../layout-dashboard';
import styles from './style.module.css';

// The workspace before the first site, or when the sites couldn't load.
function NoSites() {
	const sites = useSites();
	const openAddSite = useOpenAddSite();
	if ( sites.isError ) {
		return (
			<Empty>
				<EmptyDescription>{ __( 'Try loading your sites again.' ) }</EmptyDescription>
				<Button variant="outline" loading={ sites.isFetching } onClick={ () => sites.refetch() }>
					{ __( 'Try again' ) }
				</Button>
			</Empty>
		);
	}
	return (
		<Empty className={ styles.empty }>
			<EmptyDescription>{ __( 'Add a local WordPress site to get started.' ) }</EmptyDescription>
			<Button data-add-first-site onClick={ () => openAddSite() }>
				<PlusIcon data-icon="inline-start" />
				{ __( 'Add site' ) }
			</Button>
		</Empty>
	);
}

export const noSitesRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites',
	component: NoSites,
} );
