import { __, sprintf } from '@wordpress/i18n';
import { Tooltip } from '@wordpress/ui';
import { useSiteStorageUsage } from '@/hooks/use-site-storage-usage';
import styles from './cards.module.css';
import { CardSection } from './overview-card';
import type { SiteDetails, SiteStorageUsage } from '@/data/core';
import type { ThemeDetailsStatus } from '@/hooks/use-theme-details';

// Order is fixed: a category keeps its color no matter which ones a given site
// happens to have. "Other" (core files and everything unclassified) always
// comes last and stays neutral — it's the residual, not a category.
const STORAGE_PARTS = [
	{ id: 'uploads', label: __( 'Media' ), color: 'var(--storage-uploads)' },
	{ id: 'plugins', label: __( 'Plugins' ), color: 'var(--storage-plugins)' },
	{ id: 'themes', label: __( 'Themes' ), color: 'var(--storage-themes)' },
	{ id: 'database', label: __( 'Database' ), color: 'var(--storage-database)' },
	{ id: 'other', label: __( 'Other' ), color: 'var(--storage-other)' },
] as const satisfies readonly {
	id: keyof Omit< SiteStorageUsage, 'total' >;
	label: string;
	color: string;
}[];

/**
 * What this site is made of: the versions it runs on, its theme, and where its
 * disk space goes.
 */
export function AboutSection( {
	site,
	themeStatus,
	wpVersion,
}: {
	site: SiteDetails;
	themeStatus: ThemeDetailsStatus;
	wpVersion?: string;
} ) {
	const { data: storage, isPending: measuring } = useSiteStorageUsage( site.id );

	const themeName =
		themeStatus.state === 'ready' ? themeStatus.details.name || themeStatus.details.slug : '—';
	const total = storage ? formatBytes( storage.total ) : measuring ? __( 'Measuring…' ) : '—';

	return (
		<CardSection>
			<div className={ styles.tiles }>
				<Tile label={ __( 'Theme' ) } value={ themeName } />
				<Tile label={ __( 'WordPress' ) } value={ wpVersion || '—' } />
				<Tile label={ __( 'PHP' ) } value={ site.phpVersion } />
			</div>
			<div className={ styles.section }>
				<div className={ styles.sectionHeader }>
					<span className={ styles.tileLabel }>{ __( 'Disk' ) }</span>
					<span className={ styles.sectionValue }>{ total }</span>
				</div>
				{ storage && storage.total > 0 ? (
					<StorageBar usage={ storage } />
				) : measuring ? (
					<div className={ styles.skeleton } />
				) : null }
			</div>
		</CardSection>
	);
}

function Tile( { label, value }: { label: string; value: string } ) {
	return (
		<div className={ styles.tile }>
			<span className={ styles.tileLabel }>{ label }</span>
			<span className={ styles.tileValue } title={ value }>
				{ value }
			</span>
		</div>
	);
}

/**
 * The disk breakdown. Each segment names itself on hover or keyboard focus
 * rather than through a standing legend — the bar is the summary, and the
 * detail is one pointer away.
 */
function StorageBar( { usage }: { usage: SiteStorageUsage } ) {
	const parts = STORAGE_PARTS.map( ( part ) => ( {
		...part,
		bytes: usage[ part.id ],
		percent: ( usage[ part.id ] / usage.total ) * 100,
	} ) ).filter( ( part ) => part.bytes > 0 );

	return (
		<div className={ styles.storage }>
			<div className={ styles.storageBar }>
				{ parts.map( ( part ) => {
					const description = sprintf(
						// translators: 1: storage category, 2: size on disk, 3: share of the total.
						__( '%1$s — %2$s (%3$s)' ),
						part.label,
						formatBytes( part.bytes ),
						formatPercent( part.percent )
					);
					return (
						<Tooltip.Root key={ part.id }>
							<Tooltip.Trigger
								render={
									<div
										className={ styles.storageSegment }
										style={ { width: `${ part.percent }%`, background: part.color } }
										// Focusable so the breakdown is reachable without a pointer,
										// and named so it isn't carried by colour alone.
										tabIndex={ 0 }
										role="img"
										aria-label={ description }
									/>
								}
							/>
							<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
								<span className={ styles.storageTip }>
									<span
										className={ styles.storageSwatch }
										style={ { background: part.color } }
										aria-hidden="true"
									/>
									{ description }
								</span>
							</Tooltip.Popup>
						</Tooltip.Root>
					);
				} ) }
			</div>
		</div>
	);
}

const UNITS = [ 'B', 'KB', 'MB', 'GB', 'TB' ] as const;

export function formatBytes( bytes: number ): string {
	if ( bytes <= 0 ) {
		return '0 MB';
	}
	let value = bytes;
	let unit = 0;
	while ( value >= 1024 && unit < UNITS.length - 1 ) {
		value /= 1024;
		unit += 1;
	}
	// Sub-10 values keep a decimal so a 1.4 GB site doesn't read as 1 GB.
	const rounded = value >= 10 || unit === 0 ? Math.round( value ) : Math.round( value * 10 ) / 10;
	return `${ rounded } ${ UNITS[ unit ] }`;
}

function formatPercent( percent: number ): string {
	return `${ percent >= 1 ? Math.round( percent ) : percent.toFixed( 1 ) }%`;
}
