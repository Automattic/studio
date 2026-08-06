import { __, sprintf } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { Tooltip } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import { useSiteStorageUsage } from '@/data/queries/use-site-storage-usage';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useIsSiteStarting, useStartSite } from '@/data/queries/use-sites';
import styles from './cards.module.css';
import { CardSection } from './overview-card';
import type { SiteDetails } from '@/data/core';

const STORAGE_PARTS = [
	{ key: 'uploads', label: __( 'Media' ), className: styles.storageUploads },
	{ key: 'plugins', label: __( 'Plugins' ), className: styles.storagePlugins },
	{ key: 'themes', label: __( 'Themes' ), className: styles.storageThemes },
	{ key: 'database', label: __( 'Database' ), className: styles.storageDatabase },
	{ key: 'other', label: __( 'Other' ), className: styles.storageOther },
] as const;

export function formatBytes( bytes: number ): string {
	if ( bytes === 0 ) {
		return '0 MB';
	}
	const unitIndex = Math.min( Math.floor( Math.log( bytes ) / Math.log( 1024 ) ), 4 );
	const units = [ 'B', 'KB', 'MB', 'GB', 'TB' ];
	const value = bytes / 1024 ** unitIndex;
	return `${ value >= 10 || unitIndex === 0 ? Math.round( value ) : value.toFixed( 1 ) } ${
		units[ unitIndex ]
	}`;
}

export function AboutSection( { site, wpVersion }: { site: SiteDetails; wpVersion?: string } ) {
	const connector = useConnector();
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const themeName = site.themeDetails?.name || site.themeDetails?.slug || '—';
	const thumbnail = useSiteThumbnail( site.id );
	const storage = useSiteStorageUsage( site.id );
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
			<div className={ styles.storageSection }>
				<div className={ styles.storageHeader }>
					<span className={ styles.tileLabel }>{ __( 'Disk' ) }</span>
					<span className={ styles.storageTotal }>
						{ storage.isPending
							? __( 'Measuring…' )
							: storage.data
							? formatBytes( storage.data.total )
							: '—' }
					</span>
				</div>
				{ storage.isPending ? (
					<div className={ styles.storageSkeleton } aria-hidden="true" />
				) : storage.data && storage.data.total > 0 ? (
					<div className={ styles.storageBar } aria-label={ __( 'Disk usage breakdown' ) }>
						{ STORAGE_PARTS.map( ( part ) => {
							const bytes = storage.data?.[ part.key ] ?? 0;
							if ( bytes === 0 ) {
								return null;
							}
							const percent = ( bytes / ( storage.data?.total ?? bytes ) ) * 100;
							const label = sprintf(
								/* translators: 1: storage category, 2: formatted size, 3: percentage */
								__( '%1$s — %2$s (%3$s%%)' ),
								part.label,
								formatBytes( bytes ),
								percent < 1 ? '<1' : String( Math.round( percent ) )
							);
							return (
								<Tooltip.Root key={ part.key }>
									<Tooltip.Trigger
										render={
											<span
												role="img"
												tabIndex={ 0 }
												aria-label={ label }
												className={ `${ styles.storageSegment } ${ part.className }` }
												style={ { flexGrow: bytes } }
											/>
										}
									/>
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
										{ label }
									</Tooltip.Popup>
								</Tooltip.Root>
							);
						} ) }
					</div>
				) : null }
			</div>
		</CardSection>
	);
}
