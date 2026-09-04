import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { __, _n, sprintf } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';
import { Badge, Button, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Fragment, useMemo } from 'react';
import { ensureProtocol, stripProtocol } from '@/components/site-dropdown/utils';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import { useOffline } from '@/hooks/use-offline';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './cards.module.css';
import { CardEmptyState, CardRows, CardSection, RowDivider } from './overview-card';
import { RowLink } from './row-link';
import type { SiteDetails, Snapshot } from '@/data/core';

const LIFETIME_MS = DEMO_SITE_EXPIRATION_DAYS * DAY_MS;

export function PreviewSitesSection( { site }: { site: SiteDetails } ) {
	const { data: authUser } = useAuthUser();
	const isOffline = useOffline();
	const { data: allSnapshots } = useSnapshots( authUser?.id );
	const { data: usage } = useSnapshotUsage( authUser?.id );
	const publishPreviewSite = usePublishPreviewSite();

	const snapshots = useMemo(
		() =>
			( allSnapshots ?? [] )
				.filter( ( snapshot ) => snapshot.localSiteId === site.id )
				.sort( ( a, b ) => b.date - a.date ),
		[ allSnapshots, site.id ]
	);

	const publishAction = authUser ? (
		<div className={ styles.headerActions }>
			{ usage && usage.siteLimit > 0 ? (
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<span className={ styles.headerMeta }>
								{ sprintf(
									// translators: 1: previews in use, 2: total previews allowed.
									__( '%1$d of %2$d' ),
									usage.siteCount,
									usage.siteLimit
								) }
							</span>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ sprintf(
							// translators: 1: previews in use, 2: total previews allowed.
							__( '%1$d of %2$d preview sites used on your account' ),
							usage.siteCount,
							usage.siteLimit
						) }
					</Tooltip.Popup>
				</Tooltip.Root>
			) : null }
			<IconButton
				variant="minimal"
				tone="neutral"
				size="small"
				icon={ plus }
				label={ __( 'Publish a preview site' ) }
				disabled={ publishPreviewSite.isPending || isOffline }
				loading={ publishPreviewSite.isPending }
				loadingAnnouncement={ __( 'Publishing preview site' ) }
				onClick={ () => publishPreviewSite.mutate( { siteId: site.id } ) }
			/>
		</div>
	) : null;

	return (
		<CardSection title={ __( 'Preview sites' ) } action={ publishAction }>
			{ ! authUser ? (
				<CardEmptyState>
					{ __( 'Sign in to publish a preview site and share your work.' ) }
				</CardEmptyState>
			) : ! snapshots.length ? (
				<CardEmptyState>
					{ sprintf(
						// translators: %d: number of days a preview site stays online.
						_n(
							'No preview site yet. Publishing one gives you a shareable link for %d day.',
							'No preview site yet. Publishing one gives you a shareable link for %d days.',
							DEMO_SITE_EXPIRATION_DAYS
						),
						DEMO_SITE_EXPIRATION_DAYS
					) }
				</CardEmptyState>
			) : (
				<CardRows>
					{ snapshots.map( ( snapshot, index ) => (
						<Fragment key={ snapshot.url }>
							{ index > 0 && <RowDivider /> }
							<PreviewRow site={ site } snapshot={ snapshot } />
						</Fragment>
					) ) }
				</CardRows>
			) }
		</CardSection>
	);
}

function PreviewRow( { site, snapshot }: { site: SiteDetails; snapshot: Snapshot } ) {
	const connector = useConnector();
	const isOffline = useOffline();
	const publishPreviewSite = usePublishPreviewSite();
	const life = describeLife( snapshot );
	const url = ensureProtocol( snapshot.url );
	const published = sprintf(
		__( 'Published %s ago' ),
		formatRelativeTime( new Date( snapshot.date ).toISOString() )
	);

	const republish = () =>
		publishPreviewSite.mutate( {
			siteId: site.id,
			existingHostname: life.expired ? undefined : stripProtocol( snapshot.url ),
		} );

	return (
		<div className={ styles.row }>
			<div className={ styles.rowLine }>
				{ life.expired ? (
					<span className={ clsx( styles.rowTitle, styles.rowTitleExpired ) } title={ url }>
						{ stripProtocol( snapshot.url ) }
					</span>
				) : (
					<RowLink label={ stripProtocol( snapshot.url ) } url={ url } />
				) }
				<span className={ styles.rowMeta }>{ published }</span>
			</div>
			<div className={ styles.rowLine }>
				<div className={ styles.rowActions }>
					{ ! life.expired && (
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							size="small"
							className={ styles.rowAction }
							onClick={ () => void connector.openExternalUrl( url ) }
						>
							{ __( 'Open' ) }
						</Button>
					) }
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.rowAction }
						disabled={ publishPreviewSite.isPending || isOffline }
						onClick={ republish }
					>
						{ publishPreviewSite.isPending
							? __( 'Publishing…' )
							: life.expired
							? __( 'Republish' )
							: __( 'Update' ) }
					</Button>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.rowAction }
						onClick={ () => void connector.copyText( url ) }
					>
						{ __( 'Copy URL' ) }
					</Button>
				</div>
				<Badge
					className={ styles.rowBadge }
					intent={ life.expired ? 'high' : life.endingSoon ? 'medium' : 'stable' }
				>
					{ life.label }
				</Badge>
			</div>
		</div>
	);
}

function describeLife( snapshot: Snapshot ): {
	label: string;
	endingSoon: boolean;
	expired: boolean;
} {
	const remainingMs = snapshot.date + LIFETIME_MS - Date.now();
	if ( remainingMs <= 0 ) {
		return { label: __( 'Expired' ), endingSoon: false, expired: true };
	}

	const remainingDays = Math.ceil( remainingMs / DAY_MS );
	return {
		label: sprintf(
			// translators: %d: number of days until a preview site expires.
			_n( 'Expires in %d day', 'Expires in %d days', remainingDays ),
			remainingDays
		),
		endingSoon: remainingMs <= DAY_MS,
		expired: false,
	};
}
