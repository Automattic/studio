import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useConnector } from '@/data/core';
import { markPreviewSeen, usePreviewReady } from '@/data/preview-ready';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useSnapshotUsage, useSnapshots } from '@/data/queries/use-snapshots';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useOffline } from '@/lib/hooks';
import { ShareIcon } from '@/lib/icons';
import {
	Spinner,
	Button,
	NotificationDot,
	EmptyHeader,
	EmptyMedia,
	EmptyDescription,
} from '@/lib/ui';
import { PreviewSharePanel } from './preview-share-panel';
import styles from './style.module.css';
import type { PreviewManagementAction } from './preview-management-dialog';
import type { SiteDetails } from '@/data/core';

export function useShareStatus( siteId: string ) {
	const activity = useSiteSyncActivity( siteId );
	const ready = usePreviewReady( siteId );
	const publishing = activity?.kind === 'pending' && activity.direction === 'preview';
	let label: string | undefined;
	if ( publishing ) {
		label = activity.hostname ? __( 'Updating preview…' ) : __( 'Creating preview…' );
	} else if ( ready ) {
		label = __( 'Preview ready' );
	}
	return { publishing, ready, label };
}

export function ShareStatusIcon( {
	icon,
	status,
}: {
	icon: ReactNode;
	status: ReturnType< typeof useShareStatus >;
} ) {
	return (
		<span className={ styles.statusIcon }>
			{ status.publishing ? <Spinner /> : icon }
			{ status.ready && ! status.publishing ? <NotificationDot position="icon" /> : null }
		</span>
	);
}

export function SharePanel( {
	site,
	open,
	actionsContainer,
	onManagePreview,
}: {
	site: SiteDetails;
	open: boolean;
	actionsContainer: HTMLDivElement | null;
	onManagePreview: ( action: PreviewManagementAction ) => void;
} ) {
	const connector = useConnector();
	const primaryAction = useRef< HTMLButtonElement >( null );
	const user = useAuthUser();
	const snapshots = useSnapshots( user.data?.id );
	const usage = useSnapshotUsage( user.data?.id );
	const publish = usePublishPreviewSite();
	const [ attempt, setAttempt ] = useState< {
		siteId: string;
		userId: number;
		existingHostname?: string;
		name?: string;
	} >();
	const [ createdUrl, setCreatedUrl ] = useState< string >();
	const status = useShareStatus( site.id );
	const activity = useSiteSyncActivity( site.id );
	const siteBusy = useIsSiteBusy( site );
	const offline = useOffline();
	const signedOut = user.isSuccess && ! user.data;
	const sitePreviews = ( snapshots.data ?? [] )
		.filter( ( snapshot ) => snapshot.localSiteId === site.id )
		.sort( ( a, b ) => b.date - a.date );
	const previews = sitePreviews.filter( ( snapshot ) => ! isSnapshotExpired( snapshot ) );
	const publishing = activity?.kind === 'pending' && activity.direction === 'preview';
	const busy = siteBusy || activity?.kind === 'pending' || publish.isPending;
	const ownAttempt =
		attempt?.siteId === site.id && attempt.userId === user.data?.id ? attempt : undefined;
	const creating =
		( publishing && ! activity.hostname ) ||
		( publish.isPending && !! ownAttempt && ! ownAttempt.existingHostname );
	const error =
		ownAttempt && publish.error
			? publish.error.message
			: ( ! attempt || ownAttempt ) &&
			  activity?.kind === 'error' &&
			  activity.direction === 'preview'
			? activity.message
			: undefined;
	const canCreate =
		usage.isSuccess &&
		! usage.data?.siteCreationBlocked &&
		( usage.data?.siteCount ?? 0 ) < ( usage.data?.siteLimit ?? Infinity );
	let notice: string | undefined;
	if ( usage.data?.siteCreationBlocked ) {
		notice = __( 'Preview sites are not available for your account.' );
	} else if ( usage.data && ! canCreate ) {
		/* translators: %d: maximum number of preview sites allowed */
		notice = sprintf(
			__( "You've used all %d preview sites available on your account." ),
			usage.data.siteLimit
		);
	}
	const restriction = offline
		? __( 'Connect to the internet to create or update a preview.' )
		: ( siteBusy || activity?.kind === 'pending' ) && ! publishing
		? __( 'Wait for the current site operation to finish before creating or updating a preview.' )
		: undefined;
	const run = ( next: NonNullable< typeof attempt > ) => {
		setAttempt( next );
		publish.mutate( next, {
			onSuccess: ( result ) => {
				if ( ! next.existingHostname ) setCreatedUrl( result.url );
			},
		} );
	};
	const publishPreview = ( hostname?: string ) => {
		if ( ! user.data || busy || offline || ( ! hostname && ! canCreate ) ) return;
		run( {
			siteId: site.id,
			userId: user.data.id,
			existingHostname: hostname,
			name: hostname || previews.length ? undefined : sitePreviews[ 0 ]?.name,
		} );
	};

	useEffect( () => {
		if ( open && status.ready ) markPreviewSeen( site.id );
	}, [ open, status.ready, site.id ] );
	const loadError = user.error || ( ! snapshots.data && snapshots.error );
	if ( signedOut ) return null;

	const description = (
		<>
			{ __(
				'Share a temporary preview of your site. Update it when you want to share your latest changes.'
			) }{ ' ' }
			<Button
				variant="inline-accent"
				size="inline"
				onClick={ () =>
					void connector.openExternalUrl(
						'https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/'
					)
				}
			>
				{ __( 'Learn more…' ) }
			</Button>
		</>
	);
	return (
		<div className={ styles.content }>
			<EmptyHeader className={ styles.emptyIntro }>
				<EmptyMedia className={ styles.emptyIcon }>
					<ShareIcon width="40" height="40" />
				</EmptyMedia>
				<h2 className={ styles.emptyTitle }>{ __( 'Share a preview' ) }</h2>
				<EmptyDescription className={ styles.emptyDescription }>{ description }</EmptyDescription>
			</EmptyHeader>

			{ usage.error ? (
				<div className={ styles.error } role="alert">
					<p>{ __( 'Unable to check preview availability.' ) }</p>
					<Button variant="outline" onClick={ () => void usage.refetch() }>
						{ __( 'Reload availability' ) }
					</Button>
				</div>
			) : null }

			{ loadError ? (
				<div className={ styles.reload }>
					<Button
						onClick={ () => {
							void user.refetch();
							void snapshots.refetch();
						} }
					>
						{ __( 'Reload' ) }
					</Button>
				</div>
			) : user.isPending || snapshots.isPending ? (
				<div className={ styles.loading } role="status">
					<Spinner />
					{ __( 'Loading…' ) }
				</div>
			) : (
				<PreviewSharePanel
					key={ `${ site.id }:${ user.data?.id }` }
					site={ site }
					actionsContainer={ actionsContainer }
					primaryAction={ primaryAction }
					previews={ previews }
					busy={ busy }
					offline={ offline }
					creating={ creating }
					updatingHostname={
						publishing
							? activity.hostname
							: publish.isPending
							? ownAttempt?.existingHostname
							: undefined
					}
					canCreate={ canCreate }
					notice={ notice }
					restriction={ restriction }
					error={ error }
					onRetry={ ownAttempt && publish.error ? () => run( ownAttempt ) : undefined }
					retryCreates={ ! ownAttempt?.existingHostname }
					createdUrl={ createdUrl }
					onPublish={ publishPreview }
					onManagePreview={ onManagePreview }
				/>
			) }
		</div>
	);
}
