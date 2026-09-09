import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { Fragment, useState } from 'react';
import { ensureProtocol, stripProtocol } from '@/components/site-dropdown/utils';
import { PublishSiteDialog } from '@/components/site-toolbar/publish-site-dialog';
import { SyncDialog, type SyncDirection } from '@/components/site-toolbar/sync-dialog';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePullSiteFromLive, usePushSiteToLive } from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useIsSiteSyncing } from '@/hooks/use-is-site-syncing';
import { useOffline } from '@/hooks/use-offline';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './cards.module.css';
import {
	CardEmptyState,
	CardLoadingState,
	CardOperationProgress,
	ButtonTooltip,
	CardHeaderAction,
	CardResourceRow,
	CardRowAction,
	CardRowBadge,
	CardRows,
	CardSection,
	CardSectionFooter,
	RowDivider,
} from './overview-card';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';
import type { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';

const STALE_SYNC_MS = 14 * 24 * 60 * 60 * 1000;

export function ConnectionsSection( { site, busy }: { site: SiteDetails; busy: boolean } ) {
	const { data: authUser } = useAuthUser();
	const login = useLogin( { source: 'overview_tab' } );
	const isOffline = useOffline();
	const [ connectOpen, setConnectOpen ] = useState( false );
	const [ syncRequest, setSyncRequest ] = useState< {
		direction: SyncDirection;
		targetId: number;
	} | null >( null );
	const { data: connections, isLoading } = useConnectedWpcomSites( site.id );
	const activity = useSiteSyncActivity( site.id );
	const hasConnections = Boolean( connections?.length );
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();

	const runSync = (
		direction: SyncDirection,
		target: SyncSite,
		options: PushSyncOptions | PullSyncOptions | undefined
	) => {
		if ( direction === 'pull' ) {
			pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: target.id, options } );
			return;
		}
		pushSiteToLive.mutate( { siteId: site.id, remoteSiteId: target.id, options } );
	};

	const connectButton = (
		<CardHeaderAction
			tooltip={ __( 'Connect this local site to a live site' ) }
			disabled={ isOffline }
			onClick={ () => setConnectOpen( true ) }
		>
			{ __( 'Connect site' ) }
		</CardHeaderAction>
	);

	return (
		<>
			<CardSection>
				{ ! authUser ? (
					<CardEmptyState>
						{ __( 'Sign in to connect this site to WordPress.com and sync it.' ) }
					</CardEmptyState>
				) : isLoading && ! connections ? (
					<CardLoadingState label={ __( 'Loading connections…' ) } />
				) : ! hasConnections ? (
					<CardEmptyState>
						{ __(
							'Pull a live site into Studio, then push your local changes when they are ready.'
						) }
					</CardEmptyState>
				) : (
					<CardRows>
						{ connections?.map( ( connection, index ) => (
							<Fragment key={ connection.id }>
								{ index > 0 && <RowDivider /> }
								<ConnectionRow
									site={ site }
									connection={ connection }
									busy={ busy }
									activity={
										activity?.kind === 'pending' &&
										( activity.direction === 'push' || activity.direction === 'pull' ) &&
										activity.remoteSiteId === connection.id
											? activity
											: null
									}
									onSync={ ( direction ) =>
										setSyncRequest( { direction, targetId: connection.id } )
									}
								/>
							</Fragment>
						) ) }
					</CardRows>
				) }
				{ ! isLoading || connections ? (
					<CardSectionFooter>
						{ ! authUser ? (
							<ButtonTooltip tooltip={ __( 'Sign in to connect a live site' ) }>
								<Button
									variant="outline"
									tone="neutral"
									size="small"
									disabled={ login.isPending || isOffline }
									onClick={ () => login.mutate() }
								>
									{ __( 'Log in with WordPress.com' ) }
								</Button>
							</ButtonTooltip>
						) : (
							connectButton
						) }
					</CardSectionFooter>
				) : null }
			</CardSection>
			{ connectOpen ? (
				<PublishSiteDialog site={ site } open onOpenChange={ setConnectOpen } />
			) : null }
			{ syncRequest && connections ? (
				<SyncDialog
					siteId={ site.id }
					connections={ connections }
					open
					initialDirection={ syncRequest.direction }
					initialTargetId={ syncRequest.targetId }
					onOpenChange={ ( open ) => {
						if ( ! open ) {
							setSyncRequest( null );
						}
					} }
					onRun={ runSync }
				/>
			) : null }
		</>
	);
}

function ConnectionRow( {
	site,
	connection,
	busy,
	activity,
	onSync,
}: {
	site: SiteDetails;
	connection: SyncSite;
	busy: boolean;
	activity: SyncActivity | null;
	onSync: ( direction: SyncDirection ) => void;
} ) {
	const connector = useConnector();
	const isOffline = useOffline();
	const { push: isPushing, pull: isPulling } = useIsSiteSyncing( site.id );
	const syncing = isPushing || isPulling;
	const disabled = syncing || busy || isOffline;
	const sync = describeLastSync( connection );
	const url = ensureProtocol( connection.url );
	const syncDirection =
		activity?.kind === 'pending' &&
		( activity.direction === 'push' || activity.direction === 'pull' )
			? activity.direction
			: null;
	const syncLabel =
		syncDirection === 'push' ? __( 'Pushing' ) : syncDirection === 'pull' ? __( 'Pulling' ) : '';

	return (
		<CardResourceRow
			label={ stripProtocol( connection.url ) }
			tooltip={ connection.name }
			url={ url }
			meta={ sync.label }
			metaClassName={ clsx( sync.stale && styles.stale ) }
			actions={
				syncDirection ? (
					<CardOperationProgress
						label={ sprintf(
							__( '%1$s changes for %2$s' ),
							syncLabel,
							stripProtocol( connection.url )
						) }
						message={
							activity?.kind === 'pending' && activity.message
								? activity.message
								: syncDirection === 'push'
								? __( 'Preparing push…' )
								: __( 'Preparing pull…' )
						}
						progress={ activity?.kind === 'pending' ? activity.progress : undefined }
					/>
				) : (
					<>
						<CardRowAction
							type="button"
							tooltip={ sprintf(
								__( 'Push local changes to %s' ),
								stripProtocol( connection.url )
							) }
							disabled={ disabled }
							onClick={ () => onSync( 'push' ) }
						>
							{ isPushing ? __( 'Pushing…' ) : __( 'Push' ) }
						</CardRowAction>
						<CardRowAction
							type="button"
							tooltip={ sprintf( __( 'Pull changes from %s' ), stripProtocol( connection.url ) ) }
							disabled={ disabled }
							onClick={ () => onSync( 'pull' ) }
						>
							{ isPulling ? __( 'Pulling…' ) : __( 'Pull' ) }
						</CardRowAction>
						<CardRowAction
							type="button"
							tooltip={ __( 'Copy the live site URL' ) }
							onClick={ () => void connector.copyText( url ) }
						>
							{ __( 'Copy URL' ) }
						</CardRowAction>
					</>
				)
			}
			status={
				syncDirection ? (
					<CardRowBadge intent="medium">{ syncLabel }</CardRowBadge>
				) : (
					<CardRowBadge intent={ connection.isStaging ? 'medium' : 'stable' }>
						{ connection.isStaging ? __( 'Staging' ) : __( 'Production' ) }
					</CardRowBadge>
				)
			}
		/>
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
