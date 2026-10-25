import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { useSites } from '@/data/queries/use-sites';
import { useOpenAddSite } from '@/features/sites';
import { PlusIcon } from '@/lib/icons';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, Button } from '@/lib/ui';
import { dashboardLayoutRoute } from '../layout-dashboard';
import styles from './style.module.css';

// The workspace before the first site, or when the sites couldn't load. It
// offers Add site once Settings or the welcome has closed, and leaves for the
// sites when one appears, such as a site created in a terminal.
function NoSites() {
	const sites = useSites();
	const navigate = useNavigate();
	const openAddSite = useOpenAddSite();
	const { settings, welcome, addSite } = useSearch( { strict: false } ) as {
		settings?: string;
		welcome?: true;
		addSite?: string;
	};
	const hasSites = !! sites.data?.length;
	const empty = sites.isSuccess && ! hasSites;
	const offered = useRef( false );
	useEffect( () => {
		if ( addSite ) {
			offered.current = true;
		}
		if ( empty && ! settings && ! welcome && ! offered.current ) {
			offered.current = true;
			openAddSite();
		}
	}, [ empty, settings, welcome, addSite, openAddSite ] );
	useEffect( () => {
		if ( hasSites && ! addSite ) {
			void navigate( { to: '/', search: true, replace: true } );
		}
	}, [ hasSites, addSite, navigate ] );
	if ( sites.isError ) {
		return (
			<Empty className={ styles.empty }>
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
		<Empty className={ styles.empty }>
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
