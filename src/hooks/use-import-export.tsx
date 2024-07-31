import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { createContext, useMemo, useState, useCallback, useContext } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { ExportEvents } from '../lib/import-export/export/events';
import { generateBackupFilename } from '../lib/import-export/export/generate-backup-filename';
import { BackupCreateProgressEventData, ExportOptions } from '../lib/import-export/export/types';
import { ImportExportEventData } from '../lib/import-export/handle-events';
import { useIpcListener } from './use-ipc-listener';

type ProgressState = {
	[ siteId: string ]: {
		statusMessage: string;
		progress: number;
	};
};

interface ImportExportContext {
	importState: ProgressState;
	exportState: ProgressState;
	exportFullSite: ( selectedSite: SiteDetails ) => Promise< void >;
	exportDatabase: ( selectedSite: SiteDetails ) => Promise< void >;
}

const DEFAULT_STATE = {
	statusMessage: __( 'Starting export...' ),
	progress: 5,
};

const ImportExportContext = createContext< ImportExportContext >( {
	importState: {},
	exportState: {},
	exportFullSite: async () => undefined,
	exportDatabase: async () => undefined,
} );

export const ImportExportProvider = ( { children }: { children: React.ReactNode } ) => {
	const [ importState, setImportState ] = useState< ProgressState >( {} );
	const [ exportState, setExportState ] = useState< ProgressState >( {} );

	const exportSite = useCallback(
		async ( selectedSite: SiteDetails, options: ExportOptions ) => {
			if ( exportState[ selectedSite.id ] ) {
				return;
			}

			setExportState( ( prevState ) => ( {
				...prevState,
				[ selectedSite.id ]: DEFAULT_STATE,
			} ) );

			try {
				await getIpcApi().exportSite( options, selectedSite.id );
				getIpcApi().showNotification( {
					title: selectedSite.name,
					body: __( 'Export completed' ),
				} );
				// Delay function resolution to ensure complete export message is displayed
				await new Promise< void >( ( resolve ) => setTimeout( resolve, 500 ) );
			} catch ( error ) {
				Sentry.captureException( error );
				await getIpcApi().showMessageBox( {
					type: 'error',
					message: __( 'Failed exporting site' ),
					detail: __(
						'An error occurred while exporting the site. If this problem persists, please contact support.'
					),
					buttons: [ __( 'OK' ) ],
				} );
			} finally {
				setExportState( ( { [ selectedSite.id ]: currentProgress, ...rest } ) => ( {
					...rest,
				} ) );
			}
		},
		[ exportState ]
	);

	const exportFullSite = useCallback(
		async ( selectedSite: SiteDetails ) => {
			const fileName = generateBackupFilename( selectedSite.name );
			const path = await getIpcApi().showSaveAsDialog( {
				title: __( 'Save backup file' ),
				defaultPath: `${ fileName }.tar.gz`,
				filters: [
					{
						name: 'Compressed Backup Files',
						extensions: [ 'tar.gz', 'tzg', 'zip' ],
					},
				],
			} );
			if ( ! path ) {
				return;
			}
			const options: ExportOptions = {
				site: selectedSite,
				backupFile: path,
				includes: {
					database: true,
					uploads: true,
					plugins: true,
					themes: true,
				},
			};
			return exportSite( selectedSite, options );
		},
		[ exportSite ]
	);

	const exportDatabase = useCallback(
		async ( selectedSite: SiteDetails ) => {
			const fileName = generateBackupFilename( selectedSite.name );
			const path = await getIpcApi().showSaveAsDialog( {
				title: __( 'Save database file' ),
				defaultPath: `${ fileName }.sql`,
				filters: [
					{
						name: 'SQL dump file',
						extensions: [ 'sql' ],
					},
				],
			} );
			if ( ! path ) {
				return;
			}
			const options: ExportOptions = {
				site: selectedSite,
				backupFile: path,
				includes: {
					database: true,
					uploads: false,
					plugins: false,
					themes: false,
				},
			};
			return exportSite( selectedSite, options );
		},
		[ exportSite ]
	);

	useIpcListener( 'on-export', ( _, { event, data }: ImportExportEventData, siteId: string ) => {
		if ( ! siteId ) {
			return;
		}

		switch ( event ) {
			case ExportEvents.EXPORT_START:
				setExportState( ( prevState ) => ( { ...prevState, [ siteId ]: DEFAULT_STATE } ) );
				break;
			case ExportEvents.BACKUP_CREATE_START:
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Creating backup...' ),
						progress: 10,
					},
				} ) );
				break;
			case ExportEvents.CONFIG_EXPORT_START:
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Exporting configuration...' ),
						progress: 15,
					},
				} ) );
				break;
			case ExportEvents.CONFIG_EXPORT_COMPLETE:
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						progress: 20,
					},
				} ) );
				break;
			case ExportEvents.BACKUP_CREATE_PROGRESS: {
				const { entries } = ( data as BackupCreateProgressEventData ).progress;
				const entriesProgress = entries.processed / entries.total;
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Backing up files...' ),
						progress: Math.min( 100, 20 + entriesProgress * 80 ), // Backup creation takes progress from 20% to 100%
					},
				} ) );
				break;
			}
			case ExportEvents.EXPORT_COMPLETE:
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Export completed' ),
						progress: 100,
					},
				} ) );
				break;
			case ExportEvents.EXPORT_ERROR:
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Export failed. Please try again.' ),
					},
				} ) );
				break;
		}
	} );

	const context = useMemo< ImportExportContext >(
		() => ( {
			importState,
			exportState,
			exportFullSite,
			exportDatabase,
		} ),
		[ importState, exportState, exportFullSite, exportDatabase ]
	);

	return (
		<ImportExportContext.Provider value={ context }>{ children }</ImportExportContext.Provider>
	);
};

export const useImportExport = () => useContext( ImportExportContext );
