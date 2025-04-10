import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { createContext, useMemo, useState, useCallback, useContext } from 'react';
import { WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS } from 'src/constants';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ExportEvents } from 'src/lib/import-export/export/events';
import { generateBackupFilename } from 'src/lib/import-export/export/generate-backup-filename';
import { BackupCreateProgressEventData, ExportOptions } from 'src/lib/import-export/export/types';
import {
	ImporterEvents,
	BackupExtractEvents,
	ValidatorEvents,
} from 'src/lib/import-export/import/events';
import {
	BackupArchiveInfo,
	BackupExtractProgressEventData,
} from 'src/lib/import-export/import/types';

type ImportProgressState = {
	[ siteId: string ]: {
		statusMessage: string;
		progress: number;
		isNewSite?: boolean;
	};
};

type ExportProgressState = {
	[ siteId: string ]: {
		statusMessage: string;
		progress: number;
	};
};

interface ImportExportContext {
	importState: ImportProgressState;
	importFile: (
		file: File | BackupArchiveInfo,
		selectedSite: SiteDetails,
		options?: { showImportNotification?: boolean; isNewSite?: boolean }
	) => Promise< void >;
	clearImportState: ( siteId: string ) => void;
	isSiteImporting: ( siteId: string ) => boolean;
	isSiteExporting: ( siteId: string ) => boolean;
	exportState: ExportProgressState;
	exportFullSite: ( selectedSite: SiteDetails ) => Promise< string | undefined >;
	exportDatabase: ( selectedSite: SiteDetails ) => Promise< string | undefined >;
}

const ImportExportContext = createContext< ImportExportContext >( {
	importState: {},
	importFile: async () => undefined,
	clearImportState: () => undefined,
	isSiteImporting: () => false,
	isSiteExporting: () => false,
	exportState: {},
	exportFullSite: async () => undefined,
	exportDatabase: async () => undefined,
} );

export const ImportExportProvider = ( { children }: { children: React.ReactNode } ) => {
	const [ importState, setImportState ] = useState< ImportProgressState >( {} );
	const [ exportState, setExportState ] = useState< ExportProgressState >( {} );
	const { startServer, stopServer, updateSite } = useSiteDetails();

	const importFile = useCallback(
		async (
			file: File | BackupArchiveInfo,
			selectedSite: SiteDetails,
			{
				showImportNotification = true,
				isNewSite = false,
			}: { showImportNotification?: boolean; isNewSite?: boolean } = {}
		) => {
			if ( importState[ selectedSite.id ]?.progress < 100 ) {
				return;
			}

			setImportState( ( prevState ) => ( {
				...prevState,
				[ selectedSite.id ]: {
					statusMessage: __( 'Extracting backup…' ),
					progress: 5,
					isNewSite,
				},
			} ) );

			const handleImportError = async ( error: unknown ) => {
				if ( error instanceof Error && error.message.includes( 'Error: absolute path: /' ) ) {
					await getIpcApi().showErrorMessageBox( {
						title: __( 'Failed importing site' ),
						message: __(
							'The ZIP archive is invalid. Try to unpack and pack it again. If this problem persists, please contact support.'
						),
					} );
				} else if (
					( error as Error ).message.includes( 'WP-CLI command was canceled (timed out)' )
				) {
					await getIpcApi().showErrorMessageBox( {
						title: __( 'Failed importing site' ),
						message: sprintf(
							__(
								'The import process timed out after %d hours, which can occur when processing very large imports. If the issue persists, please contact support.'
							),
							WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS
						),
					} );
				} else {
					await getIpcApi().showErrorMessageBox( {
						title: __( 'Failed importing site' ),
						message: __(
							'An error occurred while importing the site. Verify the file is a valid Jetpack backup, Local, Playground, .wpress or .sql database file and try again. If this problem persists, please contact support.'
						),
						error,
						showOpenLogs: true,
					} );
				}
				setImportState( ( { [ selectedSite.id ]: currentProgress, ...rest } ) => ( {
					...rest,
				} ) );
			};

			try {
				await stopServer( selectedSite.id );

				const filePath = file instanceof File ? getIpcApi().getPathForFile( file ) : file.path;

				const backupFile: BackupArchiveInfo = {
					type: file.type,
					path: filePath,
				};
				const importedSite = await getIpcApi().importSite( {
					id: selectedSite.id,
					backupFile,
				} );

				await updateSite( importedSite );

				if ( showImportNotification ) {
					void getIpcApi().showNotification( {
						title: selectedSite.name,
						body: __( 'Import completed' ),
					} );
				}
			} catch ( error ) {
				await handleImportError( error );
			} finally {
				await startServer( selectedSite.id );
			}
		},
		[ importState, startServer, stopServer, updateSite ]
	);

	const clearImportState = useCallback( ( siteId: string ) => {
		setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
			...rest,
		} ) );
	}, [] );

	const isSiteImporting = useCallback(
		( siteId: string ) => !! importState[ siteId ] && importState[ siteId ].progress < 100,
		[ importState ]
	);

	useIpcListener( 'on-import', ( _, { event, data }, siteId ) => {
		if ( ! siteId ) {
			return;
		}

		switch ( event ) {
			case BackupExtractEvents.BACKUP_EXTRACT_PROGRESS: {
				const progress = ( data as BackupExtractProgressEventData )?.progress ?? 0;
				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Extracting backup files…' ),
						progress: 5 + progress * 45, // Backup extraction takes progress from 5% to 50%
					},
				} ) );
				break;
			}
			case ImporterEvents.IMPORT_START:
				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Importing backup…' ),
						progress: 55,
					},
				} ) );
				break;
			case ImporterEvents.IMPORT_DATABASE_START:
				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Importing database…' ),
						progress: 60,
					},
				} ) );
				break;
			case ImporterEvents.IMPORT_DATABASE_COMPLETE:
				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						progress: 80,
					},
				} ) );
				break;
			case ImporterEvents.IMPORT_WP_CONTENT_START:
				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Importing WordPress content…' ),
					},
				} ) );
				break;
			case ImporterEvents.IMPORT_WP_CONTENT_COMPLETE:
				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						progress: 90,
					},
				} ) );
				break;
			case ImporterEvents.IMPORT_COMPLETE:
				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Importing completed' ),
						progress: 100,
					},
				} ) );
				break;
			case ImporterEvents.IMPORT_ERROR:
			case BackupExtractEvents.BACKUP_EXTRACT_ERROR:
			case ValidatorEvents.IMPORT_VALIDATION_ERROR:
				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Import failed. Please try again.' ),
					},
				} ) );
				break;
		}
	} );

	const exportSite = useCallback(
		async ( selectedSite: SiteDetails, options: ExportOptions ): Promise< string | undefined > => {
			if ( exportState[ selectedSite.id ] ) {
				return;
			}

			setExportState( ( prevState ) => ( {
				...prevState,
				[ selectedSite.id ]: {
					statusMessage: __( 'Starting export...' ),
					progress: 5,
				},
			} ) );

			const handleExportError = async ( error?: unknown ) =>
				getIpcApi().showErrorMessageBox( {
					title: __( 'Failed exporting site' ),
					message: __(
						'An error occurred while exporting the site. If this problem persists, please contact support.'
					),
					error,
					showOpenLogs: true,
				} );

			try {
				const exportResult = await getIpcApi().exportSite( options, selectedSite.id );

				if ( ! exportResult ) {
					await handleExportError();
					return;
				}

				void getIpcApi().showNotification( {
					title: selectedSite.name,
					body: __( 'Export completed' ),
				} );
				// Delay function resolution to ensure complete export message is displayed
				await new Promise< void >( ( resolve ) => setTimeout( resolve, 500 ) );
				return options.backupFile;
			} catch ( error ) {
				Sentry.captureException( error );
				await handleExportError( error );
			} finally {
				setExportState( ( { [ selectedSite.id ]: currentProgress, ...rest } ) => ( {
					...rest,
				} ) );
			}
		},
		[ exportState ]
	);

	const isSiteExporting = useCallback(
		( siteId: string ) => !! exportState[ siteId ] && exportState[ siteId ].progress < 100,
		[ exportState ]
	);

	const exportFullSite = useCallback(
		async ( selectedSite: SiteDetails ): Promise< string | undefined > => {
			const fileName = generateBackupFilename( selectedSite.name );
			const path = await getIpcApi().showSaveAsDialog( {
				title: __( 'Save backup file' ),
				defaultPath: `${ fileName }.zip`,
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
					muPlugins: true,
					fonts: true,
				},
				phpVersion: selectedSite.phpVersion,
			};
			return exportSite( selectedSite, options );
		},
		[ exportSite ]
	);

	const exportDatabase = useCallback(
		async ( selectedSite: SiteDetails ): Promise< string | undefined > => {
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
					muPlugins: false,
					fonts: false,
				},
				phpVersion: selectedSite.phpVersion,
			};
			return exportSite( selectedSite, options );
		},
		[ exportSite ]
	);

	useIpcListener( 'on-export', ( _, { event, data }, siteId ) => {
		if ( ! siteId ) {
			return;
		}

		switch ( event ) {
			case ExportEvents.EXPORT_START:
				setExportState( ( prevState ) => ( {
					...prevState,
					[ siteId ]: {
						statusMessage: __( 'Starting export...' ),
						progress: 5,
					},
				} ) );
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
						progress: Math.min( 95, 20 + entriesProgress * 80 ), // Backup creation takes progress from 20% to 95%
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
			importFile,
			clearImportState,
			isSiteImporting,
			isSiteExporting,
			exportState,
			exportFullSite,
			exportDatabase,
		} ),
		[
			importState,
			importFile,
			clearImportState,
			isSiteImporting,
			isSiteExporting,
			exportState,
			exportFullSite,
			exportDatabase,
		]
	);

	return (
		<ImportExportContext.Provider value={ context }>{ children }</ImportExportContext.Provider>
	);
};

export const useImportExport = () => useContext( ImportExportContext );
