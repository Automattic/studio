import { __, sprintf } from '@wordpress/i18n';
import {
	arrowDown,
	arrowUp,
	copy,
	external,
	Icon,
	moreVertical,
	plus,
	reusableBlock,
} from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Fragment, useState } from 'react';
import * as Menu from '@/components/menu';
import { PublishPickerView } from '@/components/site-dropdown/publish-picker-view';
import { ensureProtocol, stripProtocol } from '@/components/site-dropdown/utils';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePullSiteFromLive, usePushSiteToLive } from '@/data/queries/use-sync-site';
import { useIsSiteSyncing } from '@/hooks/use-is-site-syncing';
import { useOffline } from '@/hooks/use-offline';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './cards.module.css';
import { CardEmptyState, CardRows, CardSection, RowDivider } from './overview-card';
import { RowLink } from './row-link';
import type { SiteDetails, SyncSite } from '@/data/core';

// Past this a connection is worth flagging: the local copy and the live site
// have had a fortnight to drift apart.
const STALE_SYNC_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The WordPress.com sites this local site is connected to, and how long it's
 * been since either end was brought up to date.
 */
export function ConnectionsSection( { site, busy }: { site: SiteDetails; busy: boolean } ) {
	const { data: authUser } = useAuthUser();
	const login = useLogin();
	const isOffline = useOffline();
	const [ pickerOpen, setPickerOpen ] = useState( false );
	const { data: connections, isLoading } = useConnectedWpcomSites( site.id );

	const connectAction = authUser ? (
		<Menu.Root open={ pickerOpen } onOpenChange={ setPickerOpen }>
			<Menu.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ plus }
						label={ __( 'Connect a WordPress.com site' ) }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end" className={ styles.pickerPopup }>
				<PublishPickerView site={ site } onClose={ () => setPickerOpen( false ) } />
			</Menu.Popup>
		</Menu.Root>
	) : null;

	return (
		<CardSection title={ __( 'Connections' ) } action={ connectAction }>
			{ ! authUser ? (
				<>
					<CardEmptyState>
						{ __( 'Sign in to connect this site to WordPress.com and sync it.' ) }
					</CardEmptyState>
					<div>
						<Button
							variant="outline"
							tone="neutral"
							size="small"
							disabled={ login.isPending || isOffline }
							onClick={ () => login.mutate() }
						>
							{ __( 'Log in with WordPress.com' ) }
						</Button>
					</div>
				</>
			) : isLoading && ! connections ? (
				<div className={ styles.skeleton } />
			) : ! connections?.length ? (
				<CardEmptyState>
					{ __( 'Not connected to a live site yet. Connect one to pull or push changes.' ) }
				</CardEmptyState>
			) : (
				<CardRows>
					{ connections.map( ( connection, index ) => (
						<Fragment key={ connection.id }>
							{ index > 0 && <RowDivider /> }
							<ConnectionRow site={ site } connection={ connection } busy={ busy } />
						</Fragment>
					) ) }
				</CardRows>
			) }
		</CardSection>
	);
}

function ConnectionRow( {
	site,
	connection,
	busy,
}: {
	site: SiteDetails;
	connection: SyncSite;
	busy: boolean;
} ) {
	const connector = useConnector();
	const isOffline = useOffline();
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();
	const { push: isPushing, pull: isPulling } = useIsSiteSyncing( site.id );

	const syncing = isPushing || isPulling;
	const disabled = syncing || busy || isOffline;
	const sync = describeLastSync( connection );
	const url = ensureProtocol( connection.url );

	return (
		<div className={ styles.row }>
			<div className={ styles.rowText }>
				<RowLink
					label={ stripProtocol( connection.url ) }
					tooltip={ connection.name }
					url={ url }
				/>
				<span className={ clsx( styles.rowMeta, sync.stale && styles.stale ) }>{ sync.label }</span>
			</div>
			<div className={ styles.rowActions }>
				<Menu.Root>
					<Menu.Trigger
						render={
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ reusableBlock }
								label={ isPulling ? __( 'Pulling…' ) : isPushing ? __( 'Pushing…' ) : __( 'Sync' ) }
								disabled={ disabled }
								loading={ syncing }
							/>
						}
					/>
					<Menu.Popup side="bottom" align="end">
						<Menu.Item
							onClick={ () =>
								pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: connection.id } )
							}
						>
							<span className={ styles.itemIcon } aria-hidden="true">
								<Icon icon={ arrowDown } size={ 18 } />
							</span>
							{ __( 'Pull from live' ) }
						</Menu.Item>
						<Menu.Item
							onClick={ () =>
								pushSiteToLive.mutate( { siteId: site.id, remoteSiteId: connection.id } )
							}
						>
							<span className={ styles.itemIcon } aria-hidden="true">
								<Icon icon={ arrowUp } size={ 18 } />
							</span>
							{ __( 'Push to live' ) }
						</Menu.Item>
					</Menu.Popup>
				</Menu.Root>
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
						<Menu.Item onClick={ () => void connector.openExternalUrl( url ) }>
							<span className={ styles.itemIcon } aria-hidden="true">
								<Icon icon={ external } size={ 18 } />
							</span>
							{ __( 'Open live site' ) }
						</Menu.Item>
						<Menu.Item onClick={ () => void connector.copyText( url ) }>
							<span className={ styles.itemIcon } aria-hidden="true">
								<Icon icon={ copy } size={ 18 } />
							</span>
							{ __( 'Copy URL' ) }
						</Menu.Item>
					</Menu.Popup>
				</Menu.Root>
			</div>
		</div>
	);
}

// The most recent sync in either direction, phrased so the direction is part of
// the sentence rather than something the icon has to carry.
function describeLastSync( connection: SyncSite ): { label: string; stale: boolean } {
	const pulled = connection.lastPullTimestamp ? Date.parse( connection.lastPullTimestamp ) : NaN;
	const pushed = connection.lastPushTimestamp ? Date.parse( connection.lastPushTimestamp ) : NaN;
	const hasPulled = ! Number.isNaN( pulled );
	const hasPushed = ! Number.isNaN( pushed );

	if ( ! hasPulled && ! hasPushed ) {
		return { label: __( 'Never synced' ), stale: true };
	}

	const pulledLast = hasPulled && ( ! hasPushed || pulled >= pushed );
	const timestamp = ( pulledLast ? connection.lastPullTimestamp : connection.lastPushTimestamp )!;
	const relative = formatRelativeTime( timestamp );

	return {
		label: pulledLast
			? // translators: %s: compact relative time, e.g. "2d".
			  sprintf( __( 'Pulled %s ago' ), relative )
			: // translators: %s: compact relative time, e.g. "2d".
			  sprintf( __( 'Pushed %s ago' ), relative ),
		stale: Date.now() - Math.max( hasPulled ? pulled : 0, hasPushed ? pushed : 0 ) > STALE_SYNC_MS,
	};
}
