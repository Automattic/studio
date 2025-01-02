import * as Sentry from '@sentry/electron/renderer';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo } from 'react';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from '../../constants';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { useSyncStatesProgressInfo, PushStateProgressInfo } from '../use-sync-states-progress-info';
import {
	ClearState,
	generateStateId,
	GetState,
	UpdateState,
	usePullPushStates,
} from './use-pull-push-states';
import type { SyncSite } from '../use-fetch-wpcom-sites/types';

export type SyncPushState = {
	remoteSiteId: number;
	status: PushStateProgressInfo;
	selectedSite: SiteDetails;
	isStaging: boolean;
};

export type PushStates = Record< string, SyncPushState >;
type OnPushSuccess = ( siteId: number, localSiteId: string ) => void;
type PushSite = ( connectedSite: SyncSite, selectedSite: SiteDetails ) => Promise< void >;
type IsSiteIdPushing = ( selectedSiteId: string, remoteSiteId?: number ) => boolean;

type UseSyncPushProps = {
	pushStates: PushStates;
	setPushStates: React.Dispatch< React.SetStateAction< PushStates > >;
	onPushSuccess?: OnPushSuccess;
};

export type UseSyncPush = {
	pushStates: PushStates;
	getPushState: GetState< SyncPushState >;
	pushSite: PushSite;
	isAnySitePushing: boolean;
	isSiteIdPushing: IsSiteIdPushing;
	clearPushState: ClearState;
};

export function useSyncPush( {
	pushStates,
	setPushStates,
	onPushSuccess,
}: UseSyncPushProps ): UseSyncPush {
	const { __ } = useI18n();
	const { client } = useAuth();
	const {
		updateState,
		getState: getPushState,
		clearState,
	} = usePullPushStates< SyncPushState >( pushStates, setPushStates );
	const { pushStatesProgressInfo, isKeyPushing, isKeyFinished, isKeyFailed } =
		useSyncStatesProgressInfo();

	const updatePushState = useCallback< UpdateState< SyncPushState > >(
		( selectedSiteId, remoteSiteId, state ) => {
			updateState( selectedSiteId, remoteSiteId, state );
			const statusKey = state.status?.key;

			if ( isKeyFailed( statusKey ) || isKeyFinished( statusKey ) ) {
				getIpcApi().clearSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
			} else {
				getIpcApi().addSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
			}
		},
		[ isKeyFailed, isKeyFinished, updateState ]
	);

	const clearPushState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			clearState( selectedSiteId, remoteSiteId );
			getIpcApi().clearSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
		},
		[ clearState ]
	);

	const getPushProgressInfo = useCallback(
		async ( remoteSiteId: number, syncPushState: SyncPushState ) => {
			if ( ! client ) {
				return;
			}

			const response = await client.req.get< {
				status: 'finished' | 'failed' | 'initial_backup_started' | 'archive_import_started';
				success: boolean;
				error?: string;
			} >( {
				path: `/sites/${ remoteSiteId }/studio-app/sync/import`,
				apiNamespace: 'wpcom/v2',
			} );

			let status: PushStateProgressInfo = pushStatesProgressInfo.importing;
			if ( response.success && response.status === 'finished' ) {
				status = pushStatesProgressInfo.finished;
				onPushSuccess?.( remoteSiteId, syncPushState.selectedSite.id );
				getIpcApi().showNotification( {
					title: syncPushState.selectedSite.name,
					body: syncPushState.isStaging
						? __( 'Staging has been updated' )
						: __( 'Production has been updated' ),
				} );
			} else if ( response.success && response.status === 'failed' ) {
				status = pushStatesProgressInfo.failed;
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pushing to %s' ), syncPushState.selectedSite.name ),
					message:
						response.error === 'Import timed out'
							? __(
									"A timeout error occurred while pushing the site, likely due to its large size. Please try reducing the site's content or files and try again. If this problem persists, please contact support."
							  )
							: __(
									'An error occurred while pushing the site. If this problem persists, please contact support.'
							  ),
					showOpenLogs: true,
				} );
			}
			// Update state in any case to keep polling push state
			updatePushState( syncPushState.selectedSite.id, syncPushState.remoteSiteId, {
				status,
			} );
		},
		[
			__,
			client,
			onPushSuccess,
			pushStatesProgressInfo.failed,
			pushStatesProgressInfo.finished,
			pushStatesProgressInfo.importing,
			updatePushState,
		]
	);

	const getErrorFromResponse = useCallback(
		( error: unknown ): string => {
			if (
				typeof error === 'object' &&
				error !== null &&
				'error' in error &&
				typeof ( error as { error: unknown } ).error === 'string'
			) {
				return ( error as { error: string } ).error;
			}

			return __( 'Studio was unable to connect to WordPress.com. Please try again.' );
		},
		[ __ ]
	);

	const pushSite = useCallback< PushSite >(
		async ( connectedSite, selectedSite ) => {
			if ( ! client ) {
				return;
			}
			const remoteSiteId = connectedSite.id;
			updatePushState( selectedSite.id, remoteSiteId, {
				remoteSiteId,
				status: pushStatesProgressInfo.creatingBackup,
				selectedSite,
				isStaging: connectedSite.isStaging,
			} );

			let archiveContent, archivePath, archiveSizeInBytes;

			try {
				const result = await getIpcApi().exportSiteToPush( selectedSite.id );
				( { archiveContent, archivePath, archiveSizeInBytes } = result );
			} catch ( error ) {
				Sentry.captureException( error );
				updatePushState( selectedSite.id, remoteSiteId, {
					status: pushStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: __(
						'An error occurred while pushing the site. If this problem persists, please contact support.'
					),
					error,
					showOpenLogs: true,
				} );
				return;
			}

			if ( archiveSizeInBytes > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
				updatePushState( selectedSite.id, remoteSiteId, {
					status: pushStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: __(
						'The site is too large to push. Please reduce the size of the site and try again.'
					),
				} );
				return;
			}

			updatePushState( selectedSite.id, remoteSiteId, {
				status: pushStatesProgressInfo.uploading,
			} );

			const file = new File( [ archiveContent ], 'loca-env-site-1.tar.gz', {
				type: 'application/gzip',
			} );
			const formData = [ [ 'import', file ] ];
			try {
				const response = await client.req.post( {
					path: `/sites/${ remoteSiteId }/studio-app/sync/import`,
					apiNamespace: 'wpcom/v2',
					formData,
				} );
				if ( response.success ) {
					updatePushState( selectedSite.id, remoteSiteId, {
						status: pushStatesProgressInfo.importing,
					} );
				} else {
					console.error( response );
					throw new Error( 'Push request failed' );
				}
			} catch ( error ) {
				Sentry.captureException( error );
				updatePushState( selectedSite.id, remoteSiteId, {
					status: pushStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: getErrorFromResponse( error ),
				} );
			} finally {
				await getIpcApi().removeTemporalFile( archivePath );
			}
		},
		[ __, client, pushStatesProgressInfo, updatePushState, getErrorFromResponse ]
	);

	useEffect( () => {
		const intervals: Record< string, NodeJS.Timeout > = {};

		Object.entries( pushStates ).forEach( ( [ key, state ] ) => {
			if ( state.status.key === pushStatesProgressInfo.importing.key ) {
				intervals[ key ] = setTimeout( () => {
					getPushProgressInfo( state.remoteSiteId, state );
				}, 2000 );
			}
		} );

		return () => {
			Object.values( intervals ).forEach( clearTimeout );
		};
	}, [ pushStates, getPushProgressInfo, pushStatesProgressInfo.importing.key ] );

	const isAnySitePushing = useMemo< boolean >( () => {
		return Object.values( pushStates ).some( ( state ) => isKeyPushing( state.status.key ) );
	}, [ pushStates, isKeyPushing ] );

	const isSiteIdPushing = useCallback< IsSiteIdPushing >(
		( selectedSiteId, remoteSiteId ) => {
			return Object.values( pushStates ).some( ( state ) => {
				if ( state.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined ) {
					return isKeyPushing( state.status.key ) && state.remoteSiteId === remoteSiteId;
				}
				return isKeyPushing( state.status.key );
			} );
		},
		[ pushStates, isKeyPushing ]
	);

	return { pushStates, getPushState, pushSite, isAnySitePushing, isSiteIdPushing, clearPushState };
}
