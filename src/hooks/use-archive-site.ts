import * as Sentry from '@sentry/electron/renderer';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo } from 'react';
import { DEMO_SITE_SIZE_LIMIT_BYTES, DEMO_SITE_SIZE_LIMIT_GB } from 'common/constants';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useArchiveErrorMessages } from 'src/hooks/use-archive-error-messages';
import { useAuth } from 'src/hooks/use-auth';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { isWpcomNetworkError } from 'src/lib/is-wpcom-network-error';

export function useArchiveSite() {
	const { uploadingSites, setUploadingSites, selectedSite } = useSiteDetails();
	const { snapshots, addSnapshot, fetchSnapshotUsage, startCreationProgress } = useSnapshots();
	const isUploadingSiteId = useCallback(
		( localSiteId: string ) => uploadingSites[ localSiteId ] || false,
		[ uploadingSites ]
	);
	const { client, user } = useAuth();
	const { __ } = useI18n();
	const { connectedSites } = useSyncSites();

	const getNextSequenceNumber = (
		siteId: string,
		snapshots: Array< Snapshot >,
		userId: number | null
	): number => {
		const siteSnapshots = snapshots.filter(
			( s ) => s.localSiteId === siteId && s.userId === userId
		);
		const existingSequences = siteSnapshots
			.map( ( s ) => s.sequence ?? 0 )
			.filter( ( n ) => ! isNaN( n ) );
		return existingSequences.length > 0 ? Math.max( ...existingSequences ) + 1 : 1;
	};

	const errorMessages = useArchiveErrorMessages();
	const archiveSite = useCallback(
		async ( siteId: string ) => {
			startCreationProgress();
			if ( ! client || ! user?.id ) {
				// No-op if logged out
				getIpcApi().showErrorMessageBox( {
					title: __( 'Failed to archive site' ),
					message: sprintf(
						__( 'There was an authentication error. Please reauthenticate and try again.' )
					),
				} );
				return;
			}

			setUploadingSites( ( _uploadingSites ) => ( { ..._uploadingSites, [ siteId ]: true } ) );

			const snapshotUsage = await fetchSnapshotUsage();
			if ( snapshotUsage?.site_creation_blocked ) {
				alert( errorMessages.rest_site_creation_blocked );
				setUploadingSites( ( _uploadingSites ) => ( { ..._uploadingSites, [ siteId ]: false } ) );
				return;
			}

			let archivePath = '';
			try {
				const { archivePath: tempArchivePath, archiveSizeInBytes } = await getIpcApi().archiveSite(
					siteId,
					'zip'
				);
				archivePath = tempArchivePath;

				if ( archiveSizeInBytes > DEMO_SITE_SIZE_LIMIT_BYTES ) {
					getIpcApi().showErrorMessageBox( {
						title: __( 'Adding preview site failed' ),
						message: sprintf(
							__(
								'The site exceeds the maximum size of %dGB. Please remove some files and try again.'
							),
							DEMO_SITE_SIZE_LIMIT_GB
						),
					} );
					setUploadingSites( ( _uploadingSites ) => ( { ..._uploadingSites, [ siteId ]: false } ) );
					getIpcApi().removeTemporalFile( archivePath );
					return;
				}

				const file = new File(
					[ await getIpcApi().getFileContent( archivePath ) ],
					'loca-env-site-1.zip',
					{
						type: 'application/zip',
					}
				);

				const formData: Array< [ string, string | number | File ] > = [ [ 'import', file ] ];
				const wordpressVersion = await getIpcApi().getWpVersion( siteId );
				if ( wordpressVersion.length >= 3 ) {
					formData.push( [ 'wordpress_version', wordpressVersion ] );
				}

				const connectedProductionSite = connectedSites.find( ( site ) => ! site.isStaging );
				if ( connectedProductionSite ) {
					formData.push( [ 'connected_site_id', connectedProductionSite.id ] );
				}

				try {
					const response: {
						atomic_site_id: number;
						domain_name: string;
						admin_pass: string;
						admin_user: string;
						job_id: number;
					} = await client.req.post( {
						path: '/jurassic-ninja/create-new-site-from-zip',
						apiNamespace: 'wpcom/v2',
						formData,
					} );

					const nextSequence = getNextSequenceNumber( siteId, snapshots, user.id );

					addSnapshot( {
						url: response.domain_name,
						atomicSiteId: response.atomic_site_id,
						localSiteId: siteId,
						date: new Date().getTime(),
						isLoading: true,
						name: sprintf(
							/* translators: 1: Site name 2: Sequence number  (e.g. "My Site Name Preview 1") */
							__( '%1$s Preview %2$d' ),
							selectedSite?.name,
							nextSequence
						),
						sequence: nextSequence,
						userId: user.id,
					} );
				} catch ( error ) {
					if ( isWpcomNetworkError( error ) ) {
						if ( error.code in errorMessages ) {
							alert( errorMessages[ error.code as keyof typeof errorMessages ] );
						} else {
							alert( __( 'Error sharing site. Please try again.' ) );
						}
						if ( error.code !== 'rest_site_limit_reached' ) {
							Sentry.captureException( error );
						}
					} else {
						alert( __( 'Error sharing site. Please contact support.' ) );
						Sentry.captureException( error );
					}
				} finally {
					getIpcApi().removeTemporalFile( archivePath );
				}
			} catch ( error ) {
				getIpcApi().showErrorMessageBox( {
					title: __( 'Archiving failed' ),
					message: __( 'Error sharing site. Please try again.' ),
					error,
				} );
				Sentry.captureException( error );
			} finally {
				setUploadingSites( ( _uploadingSites ) => ( { ..._uploadingSites, [ siteId ]: false } ) );
				if ( archivePath ) {
					getIpcApi().removeTemporalFile( archivePath );
				}
			}
		},
		[
			__,
			addSnapshot,
			client,
			user,
			errorMessages,
			fetchSnapshotUsage,
			setUploadingSites,
			connectedSites,
			selectedSite,
			snapshots,
			startCreationProgress,
		]
	);

	const { isAnySiteArchiving, archivingSiteId } = useMemo( () => {
		const uploadingSiteId = Object.keys( uploadingSites ).find(
			( siteId ) => uploadingSites[ siteId ]
		);
		const loadingSnapshot = snapshots.find( ( snapshot ) => snapshot.isLoading );

		return {
			isAnySiteArchiving: !! uploadingSiteId || !! loadingSnapshot,
			archivingSiteId: uploadingSiteId || loadingSnapshot?.localSiteId || null,
		};
	}, [ uploadingSites, snapshots ] );

	return {
		archiveSite,
		isUploadingSiteId,
		isAnySiteArchiving,
		archivingSiteId,
	};
}
