import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { useSites } from '@/data/queries/use-sites';
import { useSidebarCollapsed } from '@/data/use-sidebar-collapsed';
import { HeaderSidebarToggle } from '@/features/sidebar';
import { PreviewParticles, useOpenAddSite } from '@/features/sites';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
	Button,
	StudioIcon,
} from '@/lib/ui';
import { dashboardLayoutRoute } from '../layout-dashboard';
import styles from './style.module.css';

// The band above the empty workspace, keeping the sidebar toggle in reach
// when the sidebar is hidden or opens over the content on a small window.
function NoSitesHeader() {
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	return (
		<header
			className={ clsx(
				styles.header,
				sidebarCollapsed && reserveTrafficLightSpace && styles.headerSidebarCollapsed
			) }
		>
			<HeaderSidebarToggle />
		</header>
	);
}

// The workspace before the first site, or when the sites couldn't load. It
// offers Add site once, unless the welcome is showing (it opens Add site
// itself), and leaves for the sites when one appears, such as a site created
// in a terminal.
function NoSites() {
	return (
		<>
			<NoSitesHeader />
			<NoSitesContent />
		</>
	);
}

function NoSitesContent() {
	const sites = useSites();
	const navigate = useNavigate();
	const openAddSite = useOpenAddSite();
	const { welcome, addSite, settings } = useSearch( { strict: false } ) as {
		welcome?: true;
		addSite?: string;
		settings?: string;
	};
	const hasSites = !! sites.data?.length;
	const empty = sites.isSuccess && ! hasSites;
	const offered = useRef( false );
	useEffect( () => {
		if ( empty && ! welcome && ! offered.current ) {
			offered.current = true;
			if ( ! addSite && ! settings ) {
				openAddSite();
			}
		}
	}, [ empty, welcome, addSite, settings, openAddSite ] );
	useEffect( () => {
		if ( hasSites && ! addSite ) {
			void navigate( { to: '/', search: true, replace: true } );
		}
	}, [ hasSites, addSite, navigate ] );
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
		<Empty className={ styles.workspace }>
			<div className={ styles.dots } aria-hidden="true">
				<PreviewParticles active />
			</div>
			<StudioIcon />
			<EmptyHeader>
				<EmptyTitle className={ styles.title }>{ __( 'Welcome to WordPress Studio' ) }</EmptyTitle>
			</EmptyHeader>
			<EmptyContent>
				<Button variant="accent" size="lg" data-add-first-site onClick={ () => openAddSite() }>
					{ __( 'Start here' ) }
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
