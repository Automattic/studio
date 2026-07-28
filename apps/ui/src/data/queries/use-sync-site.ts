import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import {
	getImportStatusPendingDetails,
	monitorLiveSyncImport,
} from '@/data/queries/use-live-sync-monitor';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import {
	reportSyncError,
	reportSyncPending,
	reportSyncProgress,
	reportSyncSuccess,
} from '@/data/sync-activity';
import type { LiveSyncOptions, PullSiteProgress } from '@/data/core';

// Mutation keys are exported so downstream consumers (e.g. a cross-page
// activity indicator or future bulk-sync UI) can filter the react-query
// mutation cache for in-flight push/pull operations by site.
export const PUSH_TO_LIVE_MUTATION_KEY = [ 'pushSiteToLive' ] as const;
export const PULL_FROM_LIVE_MUTATION_KEY = [ 'pullSiteFromLive' ] as const;

type PushToLiveVariables = {
	siteId: string;
	remoteSiteId: number;
	options?: LiveSyncOptions;
};

export function usePushSiteToLive() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
		mutationFn: async ( { siteId, remoteSiteId, options }: PushToLiveVariables ) => {
			const currentStatus = await connector
				.getLiveSyncImportStatus( remoteSiteId )
				.catch( () => null );
			if ( currentStatus && getImportStatusPendingDetails( currentStatus ) ) {
				await monitorLiveSyncImport( {
					connector,
					siteId,
					remoteSiteId,
				} );
				await connector.markLiveSiteSynced( siteId, remoteSiteId, 'push' );
				return;
			}

			await connector.pushSiteToLive( siteId, remoteSiteId, options );
			await monitorLiveSyncImport( {
				connector,
				siteId,
				remoteSiteId,
				reportInitialFailure: true,
			} );
			await connector.markLiveSiteSynced( siteId, remoteSiteId, 'push' );
		},
		onMutate: ( { siteId, remoteSiteId } ) => {
			reportSyncPending( siteId, 'push', {
				phase: 'uploading',
				progress: null,
				remoteSiteId,
				logMessage: __( 'Uploading selected changes to live site.' ),
			} );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'push' );
			toast.success( __( 'Push complete' ) );
			void queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( siteId ),
			} );
			void queryClient.invalidateQueries( {
				queryKey: [ 'liveSyncLatestBackupTime' ],
			} );
		},
		onError: ( error, { siteId } ) => {
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'push', message );
			// The sync-activity report above only surfaces in the site
			// dropdown; the toast reaches the user wherever they are.
			toast.error( __( 'Push didn’t complete' ), { description: message } );
		},
	} );
}

type DisconnectWpcomSiteVariables = {
	siteId: string;
	remoteSiteId: number;
};

export function useDisconnectWpcomSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, remoteSiteId }: DisconnectWpcomSiteVariables ) =>
			connector.disconnectWpcomSite( siteId, remoteSiteId ),
		onSuccess: ( _result, { siteId } ) => {
			void queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( siteId ),
			} );
		},
	} );
}

type PullFromLiveVariables = {
	siteId: string;
	remoteSiteId: number;
	options?: LiveSyncOptions;
	onProgress?: ( progress: PullSiteProgress ) => void;
};

export function usePullSiteFromLive() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId, options, onProgress }: PullFromLiveVariables ) =>
			connector.pullSiteFromLive( siteId, remoteSiteId, options, ( progress ) => {
				reportSyncProgress( siteId, 'pull', progress );
				onProgress?.( progress );
			} ),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'pull', {
				logMessage: __( 'Pulling selected live-site changes into Studio.' ),
			} );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'pull' );
			toast.success( __( 'Pull complete' ) );
			// The CLI may have stopped/started the server during the import,
			// and the site's database + themes just changed — refresh the
			// site list so any downstream consumers see the new state.
			void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
		},
		onError: ( _error, { siteId } ) => {
			const message = __(
				"Studio couldn't copy the live site. Try again. If the problem continues, check Studio Logs for details."
			);
			reportSyncError( siteId, 'pull', message );
			toast.error( __( "Pull didn't complete" ), { description: message } );
		},
	} );
}
