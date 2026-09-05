import { PreviewCommandLoggerAction } from '@studio/common/logger-actions';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/use-snapshots';
import {
	reportSyncError,
	reportSyncPending,
	reportSyncProgress,
	reportSyncSuccess,
} from '@/data/sync-activity';
import type { PreviewSiteProgress } from '@/data/core';
import type { ActivityProgress } from '@/data/sync-activity';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
};

export const PUBLISH_PREVIEW_MUTATION_KEY = [ 'publishPreviewSite' ] as const;

function getPreviewToastId( siteId: string ) {
	return `preview-publish-${ siteId }`;
}

function describePreviewProgress( progress: PreviewSiteProgress ): ActivityProgress {
	switch ( progress.action ) {
		case PreviewCommandLoggerAction.VALIDATE:
			return { message: __( 'Preparing site…' ), progress: 5 };
		case PreviewCommandLoggerAction.ARCHIVE:
			return { message: __( 'Creating archive…' ), progress: 20 };
		case PreviewCommandLoggerAction.UPLOAD:
			return { message: __( 'Uploading archive…' ), progress: 40 };
		case PreviewCommandLoggerAction.READY:
			return { message: __( 'Creating preview site…' ), progress: 60 };
		case PreviewCommandLoggerAction.APPDATA:
			return { message: __( 'Saving preview site…' ), progress: 95 };
		default:
			return { message: progress.message || __( 'Publishing preview…' ) };
	}
}

// Creates or refreshes the WordPress.com-hosted preview snapshot for a
// local site. Reports lifecycle into the shared sync-activity store so the
// site-dropdown indicator can render the pending / success / error states.
export function usePublishPreviewSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: PUBLISH_PREVIEW_MUTATION_KEY,
		mutationFn: ( { siteId, existingHostname }: PublishPreviewVariables ) =>
			connector.publishPreviewSite( siteId, existingHostname, ( progress ) => {
				const details = describePreviewProgress( progress );
				reportSyncProgress( siteId, 'preview', details );
				toast.info( __( 'Publishing preview…' ), {
					id: getPreviewToastId( siteId ),
					description: details.message,
					durationMs: 0,
				} );
			} ),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'preview' );
			toast.info( __( 'Publishing preview…' ), {
				id: getPreviewToastId( siteId ),
				description: __( 'Preparing site…' ),
				durationMs: 0,
			} );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'preview' );
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
			toast.success( __( 'Preview site published' ), { id: getPreviewToastId( siteId ) } );
		},
		onError: ( error, { siteId } ) => {
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'preview', message );
			toast.error( __( 'Failed to publish preview site' ), {
				id: getPreviewToastId( siteId ),
				description: message,
			} );
		},
	} );
}

export function useDeletePreviewSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { hostname }: { hostname: string } ) => connector.deletePreviewSite( hostname ),
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
		},
		onError: () => {
			toast.error( __( 'Failed to delete preview link' ) );
		},
	} );
}

export function useDeletePreviewSites() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: async ( hostnames: string[] ) => {
			const results = await Promise.allSettled(
				hostnames.map( ( hostname ) => connector.deletePreviewSite( hostname ) )
			);
			const failed = results.filter( ( result ) => result.status === 'rejected' );
			if ( failed.length ) {
				throw new Error( __( 'Some expired previews could not be deleted.' ) );
			}
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
		},
	} );
}
