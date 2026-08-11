import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { useSites } from '@/data/queries/use-sites';
import { reportSyncError, reportSyncPending, reportSyncSuccess } from '@/data/sync-activity';
import type { Connector, LiveSyncImportStatus } from '@/data/core';
import type { SyncPendingDetails } from '@/data/sync-activity';

const IMPORT_POLL_INTERVAL_MS = 3000;
const IMPORT_DISCOVERY_INTERVAL_MS = 30000;

const activeImportPollers = new Map< string, Promise< void > >();

function sleep( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

function clampProgress( progress: number | null | undefined ): number | null {
	if ( progress === null || progress === undefined || ! Number.isFinite( progress ) ) {
		return null;
	}
	return Math.max( 0, Math.min( 100, Math.round( progress ) ) );
}

export function getImportStatusPendingDetails(
	status: LiveSyncImportStatus
): SyncPendingDetails | null {
	switch ( status.status ) {
		case 'started':
			return { phase: 'preparing', progress: null };
		case 'initial_backup_started':
			return { phase: 'creating-backup', progress: clampProgress( status.backup_progress ) };
		case 'initial_backup_finished':
			return { phase: 'creating-backup', progress: 100 };
		case 'archive_import_started':
			return { phase: 'applying', progress: clampProgress( status.import_progress ) };
		case 'archive_import_finished':
			return { phase: 'finishing', progress: null };
		default:
			return null;
	}
}

function getImportStatusLogMessage( status: LiveSyncImportStatus ): string | null {
	switch ( status.status ) {
		case 'started':
			return __( 'Preparing live-site sync.' );
		case 'initial_backup_started': {
			const progress = clampProgress( status.backup_progress );
			if ( progress !== null ) {
				return sprintf(
					// translators: %d: backup progress percentage.
					__( 'Backing up live site (%d%%).' ),
					progress
				);
			}
			return __( 'Backing up live site.' );
		}
		case 'initial_backup_finished':
			return __( 'Live-site backup finished.' );
		case 'archive_import_started': {
			const progress = clampProgress( status.import_progress );
			if ( progress !== null ) {
				return sprintf(
					// translators: %d: import progress percentage.
					__( 'Applying live-site changes (%d%%).' ),
					progress
				);
			}
			return __( 'Applying live-site changes.' );
		}
		case 'archive_import_finished':
			return __( 'Finishing live-site sync.' );
		default:
			return null;
	}
}

function getImportFailureMessage( status: Extract< LiveSyncImportStatus, { status: 'failed' } > ) {
	return status.error || __( 'The live-site import failed.' );
}

type MonitorLiveSyncImportParams = {
	connector: Connector;
	siteId: string;
	remoteSiteId: number;
	reportInitialFailure?: boolean;
	onComplete?: () => void;
};

export function monitorLiveSyncImport( {
	connector,
	siteId,
	remoteSiteId,
	reportInitialFailure = false,
	onComplete,
}: MonitorLiveSyncImportParams ): Promise< void > {
	const key = `${ siteId }:${ remoteSiteId }`;
	const existingPoller = activeImportPollers.get( key );
	if ( existingPoller ) {
		return existingPoller;
	}

	const poller = ( async () => {
		let observedActiveImport = false;

		for (;;) {
			const status = await connector.getLiveSyncImportStatus( remoteSiteId );
			const pendingDetails = getImportStatusPendingDetails( status );

			if ( pendingDetails ) {
				observedActiveImport = true;
				reportSyncPending( siteId, 'push', {
					...pendingDetails,
					remoteSiteId,
					logMessage: getImportStatusLogMessage( status ) ?? undefined,
				} );
				await sleep( IMPORT_POLL_INTERVAL_MS );
				continue;
			}

			if ( status.status === 'failed' ) {
				if ( observedActiveImport || reportInitialFailure ) {
					const message = getImportFailureMessage( status );
					reportSyncError( siteId, 'push', message );
					throw new Error( message );
				}
				return;
			}

			if ( status.status === 'finished' ) {
				if ( observedActiveImport ) {
					reportSyncSuccess( siteId, 'push' );
					onComplete?.();
				}
				return;
			}

			return;
		}
	} )().finally( () => {
		activeImportPollers.delete( key );
	} );

	activeImportPollers.set( key, poller );
	return poller;
}

export function useLiveSyncActivityMonitor(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data: sites } = useSites();

	useEffect( () => {
		if ( ! sites?.length ) {
			return;
		}

		let cancelled = false;

		const discoverActiveImports = async () => {
			for ( const site of sites ) {
				if ( cancelled ) {
					return;
				}

				let connectedSites;
				try {
					connectedSites = await connector.getConnectedWpcomSites( site.id );
				} catch ( error ) {
					console.warn( 'Unable to check connected live sites for sync status:', error );
					continue;
				}

				for ( const connectedSite of connectedSites ) {
					if ( cancelled ) {
						return;
					}

					try {
						const status = await connector.getLiveSyncImportStatus( connectedSite.id );
						if ( ! getImportStatusPendingDetails( status ) ) {
							continue;
						}

						void monitorLiveSyncImport( {
							connector,
							siteId: site.id,
							remoteSiteId: connectedSite.id,
							onComplete: () => {
								void connector
									.markLiveSiteSynced( site.id, connectedSite.id, 'push' )
									.catch( ( error ) => {
										console.warn( 'Unable to update live sync timestamp:', error );
									} )
									.finally( () => {
										void queryClient.invalidateQueries( {
											queryKey: connectedWpcomSitesQueryKey( site.id ),
										} );
										void queryClient.invalidateQueries( {
											queryKey: [ 'liveSyncLatestBackupTime' ],
										} );
									} );
							},
						} ).catch( ( error ) => {
							console.warn( 'Live sync monitor stopped:', error );
						} );
					} catch ( error ) {
						console.warn( 'Unable to check live sync import status:', error );
					}
				}
			}
		};

		void discoverActiveImports();
		const interval = window.setInterval( discoverActiveImports, IMPORT_DISCOVERY_INTERVAL_MS );

		return () => {
			cancelled = true;
			window.clearInterval( interval );
		};
	}, [ connector, queryClient, sites ] );
}
