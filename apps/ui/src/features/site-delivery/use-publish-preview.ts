import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { useOffline } from '@studio/ds/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dismissToast, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { previewStatusQuery, usePreviewStatus } from '@/data/queries/use-preview-status';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import { getSnapshotHostname } from '@/data/snapshot-url';
import { getSyncActivityRunId, useSiteSyncActivity } from '@/data/sync-activity';
import type { SiteDetails, Snapshot } from '@/data/core';

export function usePublishPreview(
	site: SiteDetails,
	selectedSnapshot: Snapshot | undefined,
	viewingPreview: boolean,
	checkStatus: boolean
) {
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
		checkStatus && ! offline && ! busy && activity?.kind !== 'pending'
	);
	const reportedStatusErrors = useRef( new Set< number >() );
	const clearStatusError = useCallback( ( id: number ) => {
		if ( reportedStatusErrors.current.delete( id ) ) dismissToast( `preview-status-${ id }` );
	}, [] );
	const reportStatusError = useCallback(
		( snapshot: Snapshot ) => {
			reportedStatusErrors.current.add( snapshot.atomicSiteId );
			toast.error( __( 'Couldn’t check for preview edits' ), {
				id: `preview-status-${ snapshot.atomicSiteId }`,
				description: sprintf(
					/* translators: %s: the hostname of the preview site. */
					__( 'Updating %s will replace any edits made on the preview with your local copy.' ),
					getSnapshotHostname( snapshot )
				),
				action: {
					label: __( 'Check again' ),
					dismissOnSuccess: false,
					onClick: async () => {
						const result = await client
							.fetchQuery( previewStatusQuery( connector, snapshot ) )
							.catch( () => null );
						if ( result ) clearStatusError( snapshot.atomicSiteId );
					},
				},
			} );
		},
		[ client, connector, clearStatusError ]
	);
	useEffect( () => {
		if ( ! selectedPreview ) return;
		const id = selectedPreview.atomicSiteId;
		if ( status.isSuccess ) {
			clearStatusError( id );
		} else if ( viewingPreview && status.isError && ! reportedStatusErrors.current.has( id ) ) {
			reportStatusError( selectedPreview );
		}
	}, [
		viewingPreview,
		selectedPreview,
		status.isError,
		status.isSuccess,
		reportStatusError,
		clearStatusError,
	] );
	const waiting = user.isPending || ( !! user.data && ( snapshots.isPending || usage.isPending ) );
	const creationSettled =
		! publish.variables?.existingHostname &&
		activity?.direction === 'preview' &&
		activity.kind !== 'pending' &&
		publish.context?.runId !== undefined &&
		publish.context.runId === getSyncActivityRunId( site.id );
	const publishing = publish.isPending && ! creationSettled;
	const updating = preparing || publishing || activity?.kind === 'pending';
	const canUpdate = !! user.data && !! selectedPreview && ! offline && ! busy && ! updating;
	const creating =
		( publishing && ! publish.variables?.existingHostname ) ||
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
	const createPreview = async ( liveSite?: string ) => {
		if ( ! canCreate ) return;
		let result;
		try {
			result = await publish.mutateAsync( { siteId: site.id, liveSite } );
		} catch {
			return;
		}
		try {
			return new URL( /^https?:\/\//.test( result.url ) ? result.url : `https://${ result.url }` )
				.hostname;
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
				reportStatusError( snapshot );
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
		? __( 'Couldn’t check previews.' )
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
		creationSettled,
		resetCreation: publish.reset,
		canUpdate,
		overwrite,
		confirmOverwrite,
		cancelOverwrite: () => setOverwrite( undefined ),
		canPublishLive: !! user.data && ! offline && ! busy && ! updating,
		status,
		updatePreview,
		updating,
		pending: preparing || publishing,
		loading: waiting,
		previews,
		selectedPreview,
		selectPreview: setSelectedHostname,
		hasChanges: !! selectedPreview && status.isSuccess && status.data.localChanged === true,
	};
}
