import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { useSites } from '@/data/queries/use-sites';
import { useOpenAddSite } from '@/hooks/use-open-add-site';
import { PlusIcon } from '@/lib/icons/plus-icon';
import { dashboardLayoutRoute } from '../layout-dashboard';

// The workspace before the first site, or when the sites couldn't load.
function NoSites() {
	const sites = useSites();
	const openAddSite = useOpenAddSite();
	if ( sites.isError ) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyDescription>{ __( 'Try loading your sites again.' ) }</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button variant="outline" loading={ sites.isFetching } onClick={ () => sites.refetch() }>
						{ __( 'Try again' ) }
					</Button>
				</EmptyContent>
			</Empty>
		);
	}
	return (
		<Empty>
			<EmptyHeader>
				<EmptyDescription>{ __( 'Add a local WordPress site to get started.' ) }</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button data-add-first-site onClick={ () => openAddSite() }>
					<PlusIcon data-icon="inline-start" />
					{ __( 'Add site' ) }
				</Button>
			</EmptyContent>
		</Empty>
	);
}

export const noSitesRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites',
	component: NoSites,
} );
