import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { previewStatusQuery, usePreviewStatus } from '@/data/queries/use-preview-status';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import { useSyncNoticeVisibility } from '@/data/queries/use-sync-site';
import { getSnapshotHostname } from '@/data/snapshot-url';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useOffline } from '@/lib/hooks';
import type { SiteDetails, Snapshot } from '@/data/core';

export function usePublishPreview( site: SiteDetails, open = false, selectedSnapshot?: Snapshot ) {
	useSyncNoticeVisibility( site.id, open, true );
	const user = useAuthUser();
	const connector = useConnector();
	const client = useQueryClient();
	const snapshots = useSnapshots( user.data?.id );
	const usage = useSnapshotUsage( user.data?.id );
	const publish = usePublishPreviewSite();
	const [ preparing, setPreparing ] = useState( false );
	const [ overwrite, setOverwrite ] = useState< {
		snapshot: Snapshot;
		unknown: boolean;
	} >();
	const preparingRef = useRef( false );
	const activity = useSiteSyncActivity( site.id );
	const busy = useIsSiteBusy( site );
	const offline = useOffline();
	const [ selectedHostname, setSelectedHostname ] = useState< string >();
	const previews = ( snapshots.data ?? [] )
		.filter( ( snapshot ) => snapshot.localSiteId === site.id && ! isSnapshotExpired( snapshot ) )
		.sort( ( a, b ) => b.date - a.date );
	const selectedPreview =
		selectedSnapshot ??
		previews.find( ( snapshot ) => getSnapshotHostname( snapshot ) === selectedHostname ) ??
		previews[ 0 ];
	const status = usePreviewStatus(
		selectedPreview,
		! offline && ! busy && activity?.kind !== 'pending'
	);
	const waiting = user.isPending || ( !! user.data && ( snapshots.isPending || usage.isPending ) );
	const updating = preparing || publish.isPending || activity?.kind === 'pending';
	const canUpdate = !! user.data && !! selectedPreview && ! offline && ! busy && ! updating;
	const creating =
		( publish.isPending && ! publish.variables?.existingHostname ) ||
		( activity?.kind === 'pending' && activity.direction === 'preview' && ! activity.hostname );
	const limitReached =
		!! user.data &&
		usage.isSuccess &&
		!! usage.data &&
		! usage.data.siteCreationBlocked &&
		usage.data.siteCount >= usage.data.siteLimit;
	const canCreate =
		!! user.data &&
		! offline &&
		! busy &&
		! updating &&
		! waiting &&
		snapshots.isSuccess &&
		usage.isSuccess &&
		!! usage.data &&
		! usage.data.siteCreationBlocked &&
		! limitReached;
	const createPreview = async (
		onCreated?: ( hostname: string ) => void | Promise< void >,
		liveSite?: string
	) => {
		if ( ! canCreate ) return;
		let result;
		try {
			result = await publish.mutateAsync( { siteId: site.id, liveSite } );
		} catch {
			return;
		}
		try {
			const hostname = new URL(
				/^https?:\/\//.test( result.url ) ? result.url : `https://${ result.url }`
			).hostname;
			setSelectedHostname( hostname );
			await onCreated?.( hostname );
		} catch {
			toast.error( __( 'Could not open the new preview. Please try again.' ) );
		}
	};
	const upload = async ( snapshot: Snapshot ) => {
		await publish.mutateAsync( {
			siteId: site.id,
			existingHostname: getSnapshotHostname( snapshot ),
		} );
		void client.invalidateQueries( {
			queryKey: previewStatusQuery( connector, snapshot ).queryKey,
		} );
	};
	const updatePreview = async ( snapshot = selectedPreview ) => {
		if ( ! canUpdate || preparingRef.current || ! snapshot ) return;
		preparingRef.current = true;
		setPreparing( true );
		try {
			const latestStatus = await client
				.fetchQuery( previewStatusQuery( connector, snapshot ) )
				.catch( () => null );
			if ( ! latestStatus ) {
				toast.error( __( 'Could not check preview changes. Please try again.' ) );
				return;
			}
			if ( latestStatus.previewChanged !== false ) {
				setOverwrite( { snapshot, unknown: latestStatus.previewChanged === null } );
				return;
			}
			await upload( snapshot );
		} catch {
			// The preview mutation reports the failure.
		} finally {
			preparingRef.current = false;
			setPreparing( false );
		}
	};
	const confirmOverwrite = async () => {
		if (
			! canUpdate ||
			preparingRef.current ||
			! overwrite ||
			! previews.some( ( snapshot ) => snapshot.atomicSiteId === overwrite.snapshot.atomicSiteId )
		)
			return;
		preparingRef.current = true;
		setPreparing( true );
		try {
			await upload( overwrite.snapshot );
			setOverwrite( undefined );
		} catch {
			// Keep the confirmation available for retry.
		} finally {
			preparingRef.current = false;
			setPreparing( false );
		}
	};
	const unavailable = ! user.data
		? __( 'Sign in to create a preview link.' )
		: usage.isError || snapshots.isError
		? __( 'Preview availability could not be checked. Try again.' )
		: usage.data?.siteCreationBlocked
		? __( 'Preview creation is temporarily unavailable for your account.' )
		: undefined;
	return {
		unavailable,
		availabilityError: usage.isError || snapshots.isError,
		limitReached,
		signedOut: user.isSuccess && ! user.data,
		retryAvailability: () => {
			void usage.refetch();
			void snapshots.refetch();
		},
		canCreate,
		createPreview,
		creating,
		canUpdate,
		overwrite,
		confirmOverwrite,
		cancelOverwrite: () => setOverwrite( undefined ),
		canPublishLive: !! user.data && ! offline && ! busy && ! updating,
		status,
		updatePreview,
		updating,
		pending: preparing || publish.isPending,
		loading: waiting,
		previews,
		selectedPreview,
		selectPreview: setSelectedHostname,
		hasChanges: !! selectedPreview && status.isSuccess && status.data.localChanged === true,
	};
}
