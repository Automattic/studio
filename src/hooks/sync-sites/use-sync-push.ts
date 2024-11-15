import * as Sentry from '@sentry/electron/renderer';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo } from 'react';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from '../../constants';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { SyncSite } from '../use-fetch-wpcom-sites';
import { useSyncStatesProgressInfo, PushStateProgressInfo } from '../use-sync-states-progress-info';
import { usePullPushStates } from './use-pull-push-states';

export type SyncPushState = {
	remoteSiteId: number;
	status: PushStateProgressInfo;
	selectedSite: SiteDetails;
	isStaging: boolean;
};

export function useSyncPush( {
	pushStates,
	setPushStates,
}: {
	pushStates: Record< string, SyncPushState >;
	setPushStates: React.Dispatch< React.SetStateAction< Record< string, SyncPushState > > >;
} ) {
	const { __ } = useI18n();
	const { client } = useAuth();
	const {
		updateState: updatePushState,
		getState,
		clearState: clearPushState,
	} = usePullPushStates< SyncPushState >( pushStates, setPushStates );
	const { pushStatesProgressInfo, isKeyPushing, isKeyFinished, isKeyFailed } =
		useSyncStatesProgressInfo();

	const getPushProgressInfo = useCallback(
		async ( remoteSiteId: number, syncPushState: SyncPushState ) => {
			if ( ! client ) {
				return;
			}

			const response = await client.req.get< {
				status: 'finished' | 'failed' | 'initial_backup_started' | 'archive_import_started';
				success: boolean;
			} >( {
				path: `/sites/${ remoteSiteId }/studio-app/sync/import`,
				apiNamespace: 'wpcom/v2',
			} );

			let status: PushStateProgressInfo = pushStatesProgressInfo.importing;
			if ( response.success && response.status === 'finished' ) {
				status = pushStatesProgressInfo.finished;
				getIpcApi().showNotification( {
					title: syncPushState.selectedSite.name,
					body: syncPushState.isStaging
						? __( 'Staging has been updated' )
						: __( 'Production has been updated' ),
				} );
			} else if ( response.success && response.status === 'failed' ) {
				status = pushStatesProgressInfo.failed;
			}
			// Update state in any case to keep polling push state
			updatePushState( syncPushState.selectedSite.id, syncPushState.remoteSiteId, {
				status,
			} );
		},
		[
			__,
			client,
			pushStatesProgressInfo.failed,
			pushStatesProgressInfo.finished,
			pushStatesProgressInfo.importing,
			updatePushState,
		]
	);

	const pushSite = useCallback(
		async ( connectedSite: SyncSite, selectedSite: SiteDetails ) => {
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

			const { archiveContent, archivePath, archiveSizeInBytes } = await getIpcApi().archiveSite(
				selectedSite.id,
				'tar'
			);
			if ( archiveSizeInBytes > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
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
					message: __( 'Studio was unable to connect to WordPress.com. Please try again.' ),
				} );
			} finally {
				await getIpcApi().removeTemporalFile( archivePath );
			}
		},
		[ __, client, pushStatesProgressInfo, updatePushState ]
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

	const isAnySitePushing = useMemo( () => {
		return Object.values( pushStates ).some( ( state ) => isKeyPushing( state.status.key ) );
	}, [ pushStates, isKeyPushing ] );

	const isSiteIdPushing = useCallback(
		( selectedSiteId: string ) => {
			return Object.values( pushStates ).some( ( state ) => {
				return state.selectedSite.id === selectedSiteId && isKeyPushing( state.status.key );
			} );
		},
		[ pushStates, isKeyPushing ]
	);

	const getPushState = useCallback(
		( selectedSiteId: string, remoteSiteId: number ) => {
			const state = getState( selectedSiteId, remoteSiteId );
			return {
				...state,
				isInProgress: isKeyPushing( state?.status.key ),
				hasFinished: isKeyFinished( state?.status.key ),
				isError: isKeyFailed( state?.status.key ),
			};
		},
		[ getState, isKeyFailed, isKeyFinished, isKeyPushing ]
	);

	return { pushStates, getPushState, pushSite, isAnySitePushing, isSiteIdPushing, clearPushState };
}
