import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { __, _n, sprintf } from '@wordpress/i18n';
import { copy, external, Icon, moreVertical, plus, update } from '@wordpress/icons';
import { IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Fragment, useMemo } from 'react';
import * as Menu from '@/components/menu';
import { ensureProtocol, stripProtocol } from '@/components/site-dropdown/utils';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import { useOffline } from '@/hooks/use-offline';
import styles from './cards.module.css';
import { CardEmptyState, CardRows, CardSection, RowDivider } from './overview-card';
import { RowLink } from './row-link';
import type { SiteDetails, Snapshot } from '@/data/core';

const LIFETIME_MS = DEMO_SITE_EXPIRATION_DAYS * DAY_MS;

/**
 * The share links published from this site, and how much life each has left.
 *
 * Previews expire on a fixed window, so the useful thing to show isn't when one
 * was created but how long it will keep working.
 */
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

	const republish = () =>
		publishPreviewSite.mutate( {
			siteId: site.id,
			// An expired preview can't be updated in place — publishing without a
			// hostname creates a fresh one.
			existingHostname: life.expired ? undefined : stripProtocol( snapshot.url ),
		} );

	return (
		<div className={ styles.row }>
			<div className={ styles.rowText }>
				{ /* An expired preview's address no longer resolves, so it stops
				     being a link and reads as struck out. */ }
				{ life.expired ? (
					<span className={ clsx( styles.rowTitle, styles.rowTitleExpired ) } title={ url }>
						{ stripProtocol( snapshot.url ) }
					</span>
				) : (
					<RowLink label={ stripProtocol( snapshot.url ) } url={ url } />
				) }
				<span
					className={ clsx(
						styles.rowMeta,
						life.expired ? styles.expired : life.endingSoon && styles.stale
					) }
				>
					{ life.label }
				</span>
			</div>
			<div className={ styles.rowActions }>
				{ life.expired ? (
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ update }
						label={ __( 'Republish' ) }
						disabled={ publishPreviewSite.isPending || isOffline }
						loading={ publishPreviewSite.isPending }
						loadingAnnouncement={ __( 'Publishing preview site' ) }
						onClick={ republish }
					/>
				) : (
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ external }
						label={ __( 'Open preview site' ) }
						onClick={ () => void connector.openExternalUrl( url ) }
					/>
				) }
				<Menu.Root>
					<Menu.Trigger
						render={
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ moreVertical }
								label={ __( 'More options' ) }
							/>
						}
					/>
					<Menu.Popup side="bottom" align="end">
						<Menu.Item onClick={ () => void connector.copyText( url ) }>
							<span className={ styles.itemIcon } aria-hidden="true">
								<Icon icon={ copy } size={ 18 } />
							</span>
							{ __( 'Copy link' ) }
						</Menu.Item>
						{ ! life.expired && (
							<Menu.Item
								disabled={ publishPreviewSite.isPending || isOffline }
								onClick={ republish }
							>
								<span className={ styles.itemIcon } aria-hidden="true">
									<Icon icon={ update } size={ 18 } />
								</span>
								{ __( 'Update preview' ) }
							</Menu.Item>
						) }
					</Menu.Popup>
				</Menu.Root>
			</div>
		</div>
	);
}

// How much of a preview's fixed lifetime is left.
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
