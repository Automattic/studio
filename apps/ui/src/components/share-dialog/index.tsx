import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { AccountPrompt } from '@/components/account-prompt';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldTitle } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { useConnector } from '@/data/core';
import { markPreviewSeen, usePreviewReady } from '@/data/preview-ready';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useSnapshotUsage, useSnapshots } from '@/data/queries/use-snapshots';
import { useSyncableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { subscribeHeaderPanelRequest } from '@/hooks/use-open-header-panel';
import { ShareIcon } from '@/lib/icons/share-icon';
import { PreviewSharePanel } from './preview-share-panel';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

// Offers a WordPress.com plan, for an address of one's own, to a site that has none.
function useUpgradePrompt( site: SiteDetails, open: boolean ) {
	const connector = useConnector();
	const { data: user } = useAuthUser();
	const connected = useConnectedWpcomSites( site.id );
	const syncable = useSyncableWpcomSites( { enabled: open && !! connected.data?.length } );
	const hasPlan = ! connected.data?.length
		? false
		: syncable.data?.some(
				( remote ) =>
					connected.data?.some( ( connection ) => connection.id === remote.id ) &&
					! remote.isPressable &&
					remote.hasStudioPublishingPlan === true
		  );
	const checkoutUrl = connector.getPublishCheckoutUrl( site );
	if ( ! user || ! checkoutUrl || connected.isPending || hasPlan !== false ) {
		return null;
	}
	return {
		choosePlan: () => {
			void connector.trackEvent( TRACKS_EVENTS.SYNC_PUBLISH_SITE );
			void connector.openExternalUrl( checkoutUrl );
			void connector.watchForPublishedSite?.( site.id );
		},
	};
}

export function ShareDialog( {
	site,
	open,
	onOpenChange,
}: {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const connector = useConnector();
	const descriptionId = useId();
	const user = useAuthUser();
	const snapshots = useSnapshots( user.data?.id );
	const usage = useSnapshotUsage( user.data?.id );
	const { mutate: publish } = usePublishPreviewSite();
	const activity = useSiteSyncActivity( site.id );
	const siteBusy = useIsSiteBusy( site );
	const ready = usePreviewReady( site.id );
	const upgrade = useUpgradePrompt( site, open );
	const sitePreviews = ( snapshots.data ?? [] )
		.filter( ( snapshot ) => snapshot.localSiteId === site.id )
		.sort( ( a, b ) => b.date - a.date );
	const previews = sitePreviews.filter( ( snapshot ) => ! isSnapshotExpired( snapshot ) );
	// A site whose previews all expired gets its new one under the last one's name.
	const previousName = previews.length ? undefined : sitePreviews[ 0 ]?.name;
	const publishing = activity?.kind === 'pending' && activity.direction === 'preview';
	const updatingHostname = publishing ? activity.hostname : undefined;
	const failed = activity?.kind === 'error' && activity.direction === 'preview';
	const busy = siteBusy || activity?.kind === 'pending' || snapshots.isFetching;
	const canCreate =
		! usage.data?.siteCreationBlocked &&
		( usage.data?.siteCount ?? 0 ) < ( usage.data?.siteLimit ?? Infinity );
	let limitNotice: string | undefined;
	if ( usage.data?.siteCreationBlocked ) {
		limitNotice = __( 'Preview sites are not available for your account.' );
	} else if ( ! canCreate && usage.data ) {
		limitNotice = sprintf(
			/* translators: %d: maximum number of preview sites allowed */
			__( "You've used all %d preview sites available on your account." ),
			usage.data.siteLimit
		);
	}
	const signedOut = user.isSuccess && ! user.data;
	const publishPreview = ( hostname?: string ) =>
		publish( {
			siteId: site.id,
			existingHostname: hostname,
			name: hostname ? undefined : previousName,
		} );

	useEffect( () => {
		if ( open && ready ) {
			markPreviewSeen( site.id );
		}
	}, [ open, ready, site.id ] );

	const footer = upgrade ? (
		<Field>
			<FieldContent>
				<FieldTitle>{ __( 'Give your site a memorable address' ) }</FieldTitle>
				<FieldDescription>
					{ __( 'Publish on WordPress.com with a plan to use your own domain.' ) }
				</FieldDescription>
			</FieldContent>
			<Button
				variant="outline"
				size="sm"
				onClick={ () => {
					upgrade.choosePlan();
					onOpenChange( false );
				} }
			>
				{ __( 'Choose a plan' ) }
			</Button>
		</Field>
	) : null;

	return (
		<Dialog open={ open } onOpenChange={ onOpenChange }>
			<DialogContent aria-describedby={ signedOut ? descriptionId : undefined }>
				<DialogHeader>
					<DialogTitle render={ signedOut ? <VisuallyHidden /> : undefined }>
						{ __( 'Share' ) }
					</DialogTitle>
					{ signedOut ? null : (
						<DialogDescription>
							{ __( 'Share a live preview to show your progress and get feedback.' ) }{ ' ' }
							<Button
								variant="inline-accent"
								size="inline"
								onClick={ () =>
									void connector.openExternalUrl(
										'https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/'
									)
								}
							>
								{ __( 'Learn more' ) }
							</Button>
						</DialogDescription>
					) }
				</DialogHeader>
				{ signedOut ? (
					<AccountPrompt
						title={ __( 'Share your WordPress' ) }
						description={ __(
							'Create an account or log in to share previews and keep your sites in sync.'
						) }
						descriptionId={ descriptionId }
						source="previews_tab"
					/>
				) : snapshots.error ? (
					<div className={ styles.error } role="alert">
						<p>{ snapshots.error.message }</p>
						<Button variant="outline" onClick={ () => snapshots.refetch() }>
							{ __( 'Try again' ) }
						</Button>
					</div>
				) : user.isPending || snapshots.isPending ? (
					<div className={ styles.loading } role="status">
						<Spinner />
						{ __( 'Loading…' ) }
					</div>
				) : (
					<PreviewSharePanel
						key={ site.id }
						site={ site }
						previews={ previews }
						busy={ busy }
						creating={ publishing && ! updatingHostname }
						updatingHostname={ updatingHostname }
						failed={ failed }
						canCreate={ canCreate }
						notice={ limitNotice }
						footer={ footer }
						onPublish={ publishPreview }
					/>
				) }
			</DialogContent>
		</Dialog>
	);
}

export function useShareStatus( siteId: string ) {
	const activity = useSiteSyncActivity( siteId );
	const ready = usePreviewReady( siteId );
	const publishing = activity?.kind === 'pending' && activity.direction === 'preview';
	let label: string | undefined;
	if ( publishing ) {
		label = __( 'Publishing preview…' );
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
			{ status.ready && ! status.publishing ? (
				<span className={ styles.readyDot } aria-hidden="true" />
			) : null }
		</span>
	);
}

// The preview header's Share button and its dialog.
export function ShareButton( { site, className }: { site: SiteDetails; className?: string } ) {
	const [ open, setOpen ] = useState( false );
	const status = useShareStatus( site.id );
	useEffect(
		() => subscribeHeaderPanelRequest( site.id, 'share', () => setOpen( true ) ),
		[ site.id ]
	);
	return (
		<span className={ className }>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							aria-label={ __( 'Share' ) }
							aria-description={ status.label }
							aria-haspopup="dialog"
							onClick={ () => setOpen( true ) }
						>
							<ShareStatusIcon icon={ <ShareIcon /> } status={ status } />
						</Button>
					}
				/>
				<TooltipContent side="bottom">{ __( 'Share' ) }</TooltipContent>
			</Tooltip>
			<ShareDialog site={ site } open={ open } onOpenChange={ setOpen } />
		</span>
	);
}
