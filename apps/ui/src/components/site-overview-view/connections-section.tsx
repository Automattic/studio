import { __, sprintf } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';
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

const STALE_SYNC_MS = 14 * 24 * 60 * 60 * 1000;

export function ConnectionsSection( { site, busy }: { site: SiteDetails; busy: boolean } ) {
	const { data: authUser } = useAuthUser();
	const login = useLogin( { source: 'overview_tab' } );
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
				<div className={ styles.connectionSkeleton } />
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
			<div className={ styles.rowLine }>
				<RowLink
					label={ stripProtocol( connection.url ) }
					tooltip={ connection.name }
					url={ url }
				/>
				<span className={ clsx( styles.rowMeta, sync.stale && styles.stale ) }>{ sync.label }</span>
			</div>
			<div className={ styles.rowLine }>
				<div className={ styles.rowActions }>
					<button
						type="button"
						className={ styles.rowAction }
						disabled={ disabled }
						onClick={ () =>
							pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: connection.id } )
						}
					>
						{ isPulling ? __( 'Pulling…' ) : __( 'Pull' ) }
					</button>
					<button
						type="button"
						className={ styles.rowAction }
						disabled={ disabled }
						onClick={ () =>
							pushSiteToLive.mutate( { siteId: site.id, remoteSiteId: connection.id } )
						}
					>
						{ isPushing ? __( 'Pushing…' ) : __( 'Push' ) }
					</button>
					<button
						type="button"
						className={ styles.rowAction }
						onClick={ () => void connector.copyText( url ) }
					>
						{ __( 'Copy' ) }
					</button>
				</div>
				<span
					className={ clsx(
						styles.rowBadge,
						connection.isStaging ? styles.rowBadgeStaging : styles.rowBadgeProduction
					) }
				>
					{ connection.isStaging ? __( 'Staging' ) : __( 'Production' ) }
				</span>
			</div>
		</div>
	);
}

export function describeLastSync( connection: SyncSite ): { label: string; stale: boolean } {
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
			? sprintf( __( 'Pulled %s ago' ), relative )
			: sprintf( __( 'Pushed %s ago' ), relative ),
		stale: Date.now() - Math.max( hasPulled ? pulled : 0, hasPushed ? pushed : 0 ) > STALE_SYNC_MS,
	};
}
