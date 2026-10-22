import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useIsSiteBusy, useStartSite } from '@/data/queries/use-sites';
import { playIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

/** A stopped site's last screenshot; clicking it starts the site. Nothing until one exists. */
export function StoppedSitePreview( { site }: { site: SiteDetails } ) {
	const { data: thumbnail } = useSiteThumbnail( site.id );
	const startSite = useStartSite();
	const isBusy = useIsSiteBusy( site );
	if ( ! thumbnail ) {
		return null;
	}
	return (
		<button
			type="button"
			className={ styles.root }
			aria-label={ __( 'Start from preview' ) }
			disabled={ isBusy }
			onClick={ () => startSite.mutate( site.id ) }
		>
			<span className={ styles.frame }>
				<img src={ thumbnail } alt={ __( 'Saved site preview' ) } draggable={ false } />
			</span>
			<span className={ styles.overlay } aria-hidden="true">
				<span className={ styles.play }>
					<Icon icon={ playIcon } size={ 32 } />
				</span>
			</span>
		</button>
	);
}
