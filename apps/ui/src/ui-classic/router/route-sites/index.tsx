import { createRoute, Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { SiteIcon } from '@/components/site-icon';
import { useSites } from '@/data/queries/use-sites';
import { dashboardLayoutRoute } from '../layout-dashboard';
import styles from './style.module.css';

export function SitesPage() {
	const { data: sites, isLoading } = useSites();

	if ( isLoading ) {
		return (
			<div className={ styles.page }>
				<p className={ styles.empty }>{ __( 'Loading…' ) }</p>
			</div>
		);
	}

	if ( ! sites || sites.length === 0 ) {
		return (
			<div className={ styles.page }>
				<h1 className={ styles.title }>{ __( 'Sites' ) }</h1>
				<p className={ styles.subtitle }>{ __( 'Create your first site to get started.' ) }</p>
				<Link to="/onboarding" className={ styles.emptyAction }>
					{ __( 'Create a site' ) }
				</Link>
			</div>
		);
	}

	return (
		<div className={ styles.page }>
			<h1 className={ styles.title }>{ __( 'Sites' ) }</h1>
			<ul className={ styles.grid }>
				{ sites.map( ( site ) => (
					<li key={ site.id }>
						<Link to="/sites/$siteId" params={ { siteId: site.id } } className={ styles.card }>
							<span className={ styles.cardIcon } aria-hidden="true">
								<SiteIcon
									seed={ `${ site.id }:${ site.name }:${ site.path }` }
									imageSrc={ site.siteIcon }
									style={ { width: 48, height: 48, borderRadius: 10 } }
								/>
							</span>
							<span className={ styles.cardName }>{ site.name }</span>
							<span className={ styles.cardStatus }>
								<span
									className={ clsx(
										styles.statusDot,
										site.running ? styles.statusDotRunning : styles.statusDotStopped
									) }
									aria-hidden="true"
								/>
								{ site.running ? __( 'Running' ) : __( 'Stopped' ) }
							</span>
						</Link>
					</li>
				) ) }
			</ul>
		</div>
	);
}

export const sitesRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites',
	component: SitesPage,
} );
