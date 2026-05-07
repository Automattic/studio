import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { SiteIcon } from '@/components/site-icon';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { DeskUserMenu } from '../chrome/user-menu';
import { desksRootRoute } from '../router/root';
import styles from './style.module.css';

export function SiteDesk() {
	const { siteId } = siteDeskRoute.useParams();
	const isFullscreen = useFullscreen();
	const { data: sites } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const siteName = site?.name ?? __( 'Site' );
	const siteIconSeed = site ? `${ site.id }:${ site.name }:${ site.path }` : siteId;

	return (
		<main className={ styles.root } aria-label={ __( 'Site desk' ) } data-site-id={ siteId }>
			<div className={ clsx( styles.chrome, isFullscreen && styles.chromeFullscreen ) }>
				<DeskUserMenu />
				<div className={ styles.sitePill }>
					<SiteIcon
						className={ styles.siteIcon }
						seed={ siteIconSeed }
						imageSrc={ site?.siteIcon }
					/>
					<span className={ styles.siteName } title={ siteName }>
						{ siteName }
					</span>
				</div>
			</div>
		</main>
	);
}

export const siteDeskRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/sites/$siteId',
	component: SiteDesk,
} );
