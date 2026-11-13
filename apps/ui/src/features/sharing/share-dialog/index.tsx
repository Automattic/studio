import { getQualifyingLiveSites } from '@studio/common/lib/live-preview-site';
import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useRemoteSites } from '@/data/queries/use-remote-sites';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useSnapshotUsage, useSnapshots } from '@/data/queries/use-snapshots';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useOffline } from '@/lib/hooks';
import { ShareIcon } from '@/lib/icons';
import { Spinner, Button, EmptyHeader, EmptyMedia, EmptyDescription } from '@/lib/ui';
import { PreviewSharePanel } from './preview-share-panel';
import styles from './style.module.css';
import type { PreviewManagementAction } from './preview-management-dialog';
import type { SiteDetails } from '@/data/core';

export function useShareStatus( siteId: string ) {
	const activity = useSiteSyncActivity( siteId );
	const publishing = activity?.kind === 'pending' && activity.direction === 'preview';
	let label: string | undefined;
	if ( publishing ) {
		label = activity.hostname ? __( 'Updating preview…' ) : __( 'Creating preview…' );
	}
	return { publishing, label };
}

export function ShareStatusIcon( {
	icon,
	status,
}: {
	icon: ReactNode;
	status: ReturnType< typeof useShareStatus >;
} ) {
	return <span className={ styles.statusIcon }>{ status.publishing ? <Spinner /> : icon }</span>;
}

export function SharePanel( {
	site,
	onManagePreview,
	createRequest,
}: {
	site: SiteDetails;
	createRequest?: number;
	onManagePreview: ( action: PreviewManagementAction ) => void;
} ) {
	const connector = useConnector();
	const primaryAction = useRef< HTMLButtonElement >( null );
	const user = useAuthUser();
	const snapshots = useSnapshots( user.data?.id );
	const usage = useSnapshotUsage( user.data?.id );
	const publish = usePublishPreviewSite();
	const connected = useRemoteSites( 'wpcom', site.id );
	const qualifying = connector.capabilities.nativeSites
		? getQualifyingLiveSites( connected.data ?? [] )
		: [];
	const [ attempt, setAttempt ] = useState< {
		siteId: string;
		userId: number;
		existingHostname?: string;
		name?: string;
		liveSite?: string;
	} >();
	const [ createdUrl, setCreatedUrl ] = useState< string >();
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
	const publishPreview = ( hostname?: string, liveSite?: string ) => {
		if ( ! user.data || busy || offline || ( ! hostname && ! canCreate ) ) return;
		run( {
			siteId: site.id,
			userId: user.data.id,
			existingHostname: hostname,
			...( liveSite !== undefined ? { liveSite } : {} ),
			name: hostname || previews.length ? undefined : sitePreviews[ 0 ]?.name,
		} );
	};

	const handledCreateRequest = useRef< number >( undefined );
	const createIfMissing = useEffectEvent( () => {
		if ( createRequest === undefined || handledCreateRequest.current === createRequest ) return;
		handledCreateRequest.current = createRequest;
		if ( user.isSuccess && snapshots.isSuccess && usage.isSuccess && previews.length === 0 ) {
			publishPreview();
		}
	} );
	useEffect( () => {
		if (
			! user.data ||
			snapshots.isFetching ||
			snapshots.isPending ||
			usage.isFetching ||
			usage.isPending
		)
			return;
		createIfMissing();
	}, [
		createRequest,
		user.data,
		snapshots.isFetching,
		snapshots.isPending,
		usage.isFetching,
		usage.isPending,
	] );

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
					void connector.openExternalUrl( 'https://wordpress.studio/docs/preview-sites/' )
				}
			>
				{ __( 'Learn more…' ) }
			</Button>
		</>
	);
	return (
		<div className={ styles.content } data-share-previews={ previews.length > 0 || undefined }>
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
					<Button onClick={ () => void usage.refetch() }>{ __( 'Reload availability' ) }</Button>
				</div>
			) : null }

			{ loadError ? (
				<div className={ styles.error } role="alert">
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
				<div className={ styles.loading }>
					<Spinner />
				</div>
			) : (
				<PreviewSharePanel
					connectedSites={ connected.data ?? [] }
					qualifyingSites={ qualifying }
					key={ `${ site.id }:${ user.data?.id }` }
					primaryAction={ primaryAction }
					previews={ previews }
					busy={ busy }
					offline={ offline }
					creating={ creating }
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
