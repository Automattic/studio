import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	reportSyncError,
	reportSyncPending,
	reportSyncProgress,
	reportSyncSuccess,
} from '@/data/sync-activity';
import type { SpacefastPublishProgress, SpacefastPublishTarget } from '@/data/core';

const SPACEFAST_ACCOUNT_QUERY_KEY = [ 'spacefast-account' ] as const;
const SPACEFAST_SPACES_QUERY_KEY = [ 'spacefast-spaces' ] as const;
const SPACEFAST_TEAMS_QUERY_KEY = [ 'spacefast-teams' ] as const;
const spacefastConnectionQueryKey = ( siteId: string ) =>
	[ 'spacefast-connection', siteId ] as const;

export function useSpacefastSignedIn() {
	const connector = useConnector();
	return useQuery( {
		queryKey: SPACEFAST_ACCOUNT_QUERY_KEY,
		queryFn: () => connector.isSpacefastSignedIn(),
	} );
}

export function useSpacefastSpaces( enabled: boolean ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: SPACEFAST_SPACES_QUERY_KEY,
		queryFn: () => connector.listSpacefastSpaces(),
		enabled,
	} );
}

export function useSpacefastTeams( enabled: boolean ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: SPACEFAST_TEAMS_QUERY_KEY,
		queryFn: () => connector.listSpacefastTeams(),
		enabled,
	} );
}

export function useSpacefastConnection( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: spacefastConnectionQueryKey( siteId ),
		queryFn: () => connector.getSpacefastConnection( siteId ),
	} );
}

// Opens Spacefast's approval page and resolves once the user approves this device.
export function useSpacefastLogin() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: async () => {
			const login = await connector.startSpacefastLogin();
			await connector.openExternalUrl( login.verificationUrl );
			await connector.completeSpacefastLogin( login );
		},
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: SPACEFAST_ACCOUNT_QUERY_KEY } );
		},
		onError: () => {
			toast.error( __( 'Could not sign in to Spacefast' ) );
		},
	} );
}

// Forgets Studio's Spacefast key. Sites stay linked to their Spaces, so signing in
// again resumes publishing to them.
export function useSpacefastLogout() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.logoutSpacefast(),
		onSuccess: () => {
			queryClient.setQueryData( SPACEFAST_ACCOUNT_QUERY_KEY, false );
			queryClient.removeQueries( { queryKey: SPACEFAST_SPACES_QUERY_KEY } );
			queryClient.removeQueries( { queryKey: SPACEFAST_TEAMS_QUERY_KEY } );
		},
	} );
}

export function useDisconnectSpacefastSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( siteId: string ) => connector.disconnectSpacefastSite( siteId ),
		onSuccess: ( _result, siteId ) => {
			void queryClient.invalidateQueries( { queryKey: spacefastConnectionQueryKey( siteId ) } );
		},
	} );
}

function getProgressMessage( progress: SpacefastPublishProgress ): string {
	if ( progress.phase === 'exporting' ) {
		return __( 'Generating static files…' );
	}
	if ( progress.phase === 'uploading' ) {
		return sprintf( __( 'Uploading %1$d of %2$d files…' ), progress.uploaded, progress.total );
	}
	return __( 'Publishing the new version…' );
}

export function usePublishToSpacefast() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, target }: { siteId: string; target: SpacefastPublishTarget } ) =>
			connector.publishToSpacefast( siteId, target, ( progress ) =>
				reportSyncProgress( siteId, 'spacefast', { message: getProgressMessage( progress ) } )
			),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'spacefast' );
		},
		onSuccess: ( connection, { siteId } ) => {
			reportSyncSuccess( siteId, 'spacefast' );
			queryClient.setQueryData( spacefastConnectionQueryKey( siteId ), connection );
			void queryClient.invalidateQueries( { queryKey: SPACEFAST_SPACES_QUERY_KEY } );
			void connector.openExternalUrl( connection.liveUrl );
		},
		onError: ( error, { siteId } ) => {
			reportSyncError(
				siteId,
				'spacefast',
				error instanceof Error ? error.message : String( error )
			);
			toast.error( __( 'Failed to publish to Spacefast' ) );
		},
	} );
}
