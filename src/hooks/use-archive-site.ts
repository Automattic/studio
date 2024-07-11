import * as Sentry from '@sentry/electron/renderer';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIMIT_ARCHIVE_SIZE } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';
import { isWpcomNetworkError } from '../lib/is-wpcom-network-error';
import { useArchiveErrorMessages } from './use-archive-error-messages';
import { useAuth } from './use-auth';
import { useSiteDetails } from './use-site-details';
import { SnapshotStatus, SnapshotStatusResponse, useSnapshots } from './use-snapshots';

export function useArchiveSite() {
	const { uploadingSites, setUploadingSites } = useSiteDetails();
	const { snapshots, addSnapshot, updateSnapshot } = useSnapshots();
	const isUploadingSiteId = useCallback(
		( localSiteId: string ) => uploadingSites[ localSiteId ] || false,
		[ uploadingSites ]
	);
	const { client } = useAuth();
	const { __ } = useI18n();
	const [ archiveError, setArchiveError ] = useState< string | null >( null );

	useEffect( () => {
		if ( ! client ) {
			// Can't poll for snapshots if logged out
			return;
		}

		const loadingSnapshots = snapshots.filter( ( snapshot ) => snapshot.isLoading );
		if ( loadingSnapshots.length === 0 ) {
			return;
		}
		const intervalId = setInterval( async () => {
			for ( const snapshot of loadingSnapshots ) {
				if ( snapshot.isLoading ) {
					try {
						const response: SnapshotStatusResponse = await client.req.get(
							'/jurassic-ninja/status',
							{
								apiNamespace: 'wpcom/v2',
								site_id: snapshot.atomicSiteId,
							}
						);
						if ( response.status === SnapshotStatus.Active ) {
							updateSnapshot( {
								...snapshot,
								isLoading: false,
							} );
						}
					} catch ( error ) {
						updateSnapshot( {
							...snapshot,
							isLoading: false,
						} );
					}
				}
			}
		}, 3000 );
		return () => {
			clearInterval( intervalId );
		};
	}, [ client, snapshots, updateSnapshot ] );

	const errorMessages = useArchiveErrorMessages();
	const archiveSite = useCallback(
		async ( siteId: string ) => {
			if ( ! client ) {
				// No-op if logged out
				return;
			}

			setUploadingSites( ( _uploadingSites ) => ( { ..._uploadingSites, [ siteId ]: true } ) );
			const { zipContent, zipPath, exceedsSizeLimit } = await getIpcApi().archiveSite( siteId );
			if ( exceedsSizeLimit ) {
				alert(
					sprintf(
						__(
							'The site exceeds the maximum size of %dMB. Please remove some files and try again.'
						),
						Math.floor( LIMIT_ARCHIVE_SIZE / 1024 / 1024 )
					)
				);
				setUploadingSites( ( _uploadingSites ) => ( { ..._uploadingSites, [ siteId ]: false } ) );
				getIpcApi().removeTemporalFile( zipPath );
				return;
			}

			const file = new File( [ zipContent ], 'loca-env-site-1.zip', {
				type: 'application/zip',
			} );

			const formData = [ [ 'import', file ] ];
			const wordpressVersion = await getIpcApi().getWpVersion( siteId );
			if ( wordpressVersion.length >= 3 ) {
				formData.push( [ 'wordpress_version', wordpressVersion ] );
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
				addSnapshot( {
					url: response.domain_name,
					atomicSiteId: response.atomic_site_id,
					localSiteId: siteId,
					date: new Date().getTime(),
					isLoading: true,
				} );
				setArchiveError( null );
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
					setArchiveError( error.code );
				} else {
					alert( __( 'Error sharing site. Please contact support.' ) );
					Sentry.captureException( error );
					setArchiveError( 'error' );
				}
			} finally {
				setUploadingSites( ( _uploadingSites ) => ( { ..._uploadingSites, [ siteId ]: false } ) );
				getIpcApi().removeTemporalFile( zipPath );
			}
		},
		[ __, addSnapshot, client, errorMessages, setUploadingSites ]
	);
	const isAnySiteArchiving = useMemo( () => {
		const isAnySiteUploading = Object.values( uploadingSites ).some( ( uploading ) => uploading );
		return isAnySiteUploading || snapshots.some( ( snapshot ) => snapshot.isLoading );
	}, [ snapshots, uploadingSites ] );

	return {
		archiveSite,
		isUploadingSiteId,
		isAnySiteArchiving,
		archiveError,
	};
}
