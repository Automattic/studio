import { __, sprintf } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { useConnector } from '@/data/core';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import styles from './cards.module.css';
import { CardSection } from './overview-card';
import type { SiteDetails } from '@/data/core';

export function AboutSection( { site, wpVersion }: { site: SiteDetails; wpVersion?: string } ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const themeName = site.themeDetails?.name || site.themeDetails?.slug || '—';
	const thumbnail = useSiteThumbnail( site.id );
	const wpLabel = wpVersion
		? sprintf(
				/* translators: %s: WordPress version number */
				__( 'WP v%s' ),
				wpVersion
		  )
		: __( 'WP —' );
	const phpLabel = sprintf(
		/* translators: %s: PHP version number */
		__( 'PHP v%s' ),
		site.phpVersion
	);
	const openSiteInBrowser = async () => {
		try {
			if ( ! site.running ) {
				await startSite.mutateAsync( site.id );
			}
			await connector.openSiteUrl( site.id, '/', { autoLogin: false } );
		} catch ( error ) {
			console.error( 'Failed to open site in browser:', error );
		}
	};

	return (
		<CardSection>
			<div className={ styles.themeSummary }>
				<button
					type="button"
					className={ styles.thumbnail }
					data-empty={ thumbnail.data ? undefined : true }
					disabled={ isStarting }
					aria-label={ __( 'Open site in browser' ) }
					onClick={ () => void openSiteInBrowser() }
				>
					{ thumbnail.data ? (
						<img
							src={ thumbnail.data }
							alt={ sprintf(
								/* translators: %s: site name */
								__( 'Screenshot of %s' ),
								site.name
							) }
						/>
					) : null }
					<span className={ styles.thumbnailOverlay } aria-hidden="true">
						{ __( 'Open site' ) }
						<Icon icon={ external } size={ 16 } />
					</span>
				</button>
				<div className={ styles.themeDetails }>
					<span className={ styles.tileLabel }>{ __( 'Theme' ) }</span>
					<span className={ styles.themeValue }>{ themeName }</span>
					<span className={ styles.themeMeta }>
						<span>{ wpLabel }</span>
						<span aria-hidden="true">•</span>
						<span>{ phpLabel }</span>
					</span>
				</div>
			</div>
		</CardSection>
	);
}
