import { generateBackupFilename } from '@studio/common/lib/generate-backup-filename';
import {
	ExportEvents,
	ImporterEvents,
	BackupExtractEvents,
	ValidatorEvents,
} from '@studio/common/lib/import-export-events';
import { __, sprintf } from '@wordpress/i18n';
import {
	createContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useCallback,
	useContext,
} from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync/sync-operations-slice';

export type ImportProgressState = {
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
		exportType?: 'full' | 'database';
		isError?: boolean;
	};
};

interface ImportExportContext {
	importState: ImportProgressState;
	importFile: (
		file: File,
		selectedSite: SiteDetails,
		options?: { showImportNotification?: boolean; isNewSite?: boolean }
	) => Promise< void >;
	clearImportState: ( siteId: string ) => void;
	isSiteImporting: ( siteId: string ) => boolean;
	isSiteExporting: ( siteId: string ) => boolean;
	exportState: ExportProgressState;
	exportFullSite: ( selectedSite: SiteDetails ) => Promise< void >;
	exportDatabase: ( selectedSite: SiteDetails ) => Promise< void >;
	clearExportState: ( siteId: string ) => void;
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
	clearExportState: () => undefined,
} );

const getWpContentTypeLabels = (): Record< string, string > => ( {
	plugins: __( 'Importing plugins…' ),
	themes: __( 'Importing themes…' ),
	uploads: __( 'Importing media uploads…' ),
	other: __( 'Importing other files…' ),
} );

export const ImportExportProvider = ( { children }: { children: React.ReactNode } ) => {
	const [ importState, setImportState ] = useState< ImportProgressState >( {} );
	const [ exportState, setExportState ] = useState< ExportProgressState >( {} );
	const { isAuthenticated } = useAuth();
	const isAnyPullActive = useRootSelector( syncOperationsSelectors.selectIsAnySitePulling );

	// Snapshot the latest pre-logout pull-active value while still authenticated.
	// pullStates is reset synchronously on userLoggedOut, so by the time the effect
	// below sees `isAuthenticated === false`, isAnyPullActive is already false.
	const hadActivePullRef = useRef( false );
	if ( isAuthenticated ) {
		hadActivePullRef.current = isAnyPullActive;
	}

	useEffect( () => {
		// On logout, only clear import/export state if no pull was in flight.
		// An active pull's import phase is driven by main-process events that
		// would just repopulate this state, so leave it alone and let the
		// import finish.
		if ( ! isAuthenticated && ! hadActivePullRef.current ) {
			setImportState( {} );
			setExportState( {} );
		}
	}, [ isAuthenticated ] );

	const importFile = useCallback(
		async (
			file: File,
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

			const filePath = getIpcApi().getPathForFile( file );

			try {
				await getIpcApi().importSite( selectedSite.id, filePath, {
					alwaysStartServer: true,
					showNotification: showImportNotification,
					// `studio_site_imported` means a user-initiated import into an existing site —
					// add-site-flow imports are not counted.
					suppressTracksEvent: isNewSite,
				} );
			} catch ( error ) {
				// The main process handles displaying the error modal, so we don't need any explicit error
				// handling here.
			}
		},
		[ importState ]
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

	useIpcListener( 'on-import', ( _, [ event, data ], siteId ) => {
		if ( ! siteId ) {
			return;
		}

		switch ( event ) {
			case BackupExtractEvents.BACKUP_EXTRACT_START: {
				const statusMessage: string = __( 'Extracting backup files…' );

				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage,
						progress: 50, // Backup extraction takes progress from 5% to 50%
					},
				} ) );
				break;
			}
			case BackupExtractEvents.BACKUP_EXTRACT_PROGRESS: {
				const progress = data.progress ?? 0;
				let statusMessage: string = __( 'Extracting backup files…' );

				if (
					data.processedFiles !== undefined &&
					data.totalFiles !== undefined &&
					data.totalFiles > 0
				) {
					const percentage = Math.round( ( data.processedFiles / data.totalFiles ) * 100 );
					statusMessage = sprintf( __( 'Extracting backup… (%d%%)' ), percentage );
				}

				// Normalize progress: some handlers emit 0-100, others emit 0-1
				const normalizedProgress = progress > 1 ? progress / 100 : progress;

				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage,
						progress: 5 + normalizedProgress * 45, // Backup extraction takes progress from 5% to 50%
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
			case ImporterEvents.IMPORT_DATABASE_PROGRESS: {
				let statusMessage: string = __( 'Importing database…' );

				if (
					data.processedFiles !== undefined &&
					data.totalFiles !== undefined &&
					data.totalFiles > 0
				) {
					const percentage = Math.round( ( data.processedFiles / data.totalFiles ) * 100 );
					statusMessage = sprintf( __( 'Importing database… (%d%%)' ), percentage );
				}

				const progressIncrement = data.totalFiles
					? ( ( data.processedFiles || 0 ) / data.totalFiles ) * 20
					: 0;

				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage,
						progress: Math.min( 80, 60 + progressIncrement ),
					},
				} ) );
				break;
			}
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
			case ImporterEvents.IMPORT_WP_CONTENT_PROGRESS: {
				let statusMessage: string = __( 'Importing WordPress content…' );

				if (
					data.type &&
					data.processedItems !== undefined &&
					data.totalItems !== undefined &&
					data.totalItems > 0
				) {
					const percentage = Math.round( ( data.processedItems / data.totalItems ) * 100 );
					const baseLabel = getWpContentTypeLabels()[ data.type ] || __( 'Importing files…' );
					statusMessage = sprintf( __( '%1$s (%2$d%%)' ), baseLabel, percentage );
				}

				const progressIncrement = data.totalItems
					? ( ( data.processedItems || 0 ) / data.totalItems ) * 10
					: 0;

				setImportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage,
						progress: Math.min( 90, 80 + progressIncrement ),
					},
				} ) );
				break;
			}
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
				clearImportState( siteId );
				break;
		}
	} );

	const exportSite = useCallback(
		async ( site: SiteDetails, backupFile: string, mode: 'full' | 'database' ): Promise< void > => {
			if ( exportState[ site.id ] ) {
				return;
			}

			setExportState( ( prevState ) => ( {
				...prevState,
				[ site.id ]: {
					statusMessage: __( 'Starting export…' ),
					progress: 5,
					exportType: mode,
				},
			} ) );

			try {
				await getIpcApi().exportSite( site.id, backupFile, {
					mode: mode === 'database' ? 'db' : 'full',
					showItemInFolder: true,
					showNotification: true,
				} );
			} catch {
				// The main process handles displaying the error modal, so we don't need any explicit error
				// handling here.
			}
		},
		[ exportState ]
	);

	const isSiteExporting = useCallback(
		( siteId: string ) => !! exportState[ siteId ] && exportState[ siteId ].progress < 100,
		[ exportState ]
	);

	const exportFullSite = useCallback(
		async ( selectedSite: SiteDetails ): Promise< void > => {
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
			return exportSite( selectedSite, path, 'full' );
		},
		[ exportSite ]
	);

	const exportDatabase = useCallback(
		async ( selectedSite: SiteDetails ): Promise< void > => {
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
			return exportSite( selectedSite, path, 'database' );
		},
		[ exportSite ]
	);

	const clearExportState = useCallback( ( siteId: string ) => {
		setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
			...rest,
		} ) );
	}, [] );

	useIpcListener( 'on-export', ( _, [ event, data ], siteId ) => {
		if ( ! siteId ) {
			return;
		}

		switch ( event ) {
			case ExportEvents.EXPORT_START:
				setExportState( ( prevState ) => ( {
					...prevState,
					[ siteId ]: {
						...prevState[ siteId ],
						statusMessage: __( 'Starting export…' ),
						progress: 5,
					},
				} ) );
				break;
			case ExportEvents.BACKUP_CREATE_START:
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Creating backup…' ),
						progress: 10,
					},
				} ) );
				break;
			case ExportEvents.CONFIG_EXPORT_START:
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Exporting configuration…' ),
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
				const entriesProgress = data.progress.entries.processed / data.progress.entries.total;
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Backing up files…' ),
						progress: Math.min( 95, 20 + entriesProgress * 80 ), // Backup creation takes progress from 20% to 95%
					},
				} ) );
				break;
			}
			case ExportEvents.EXPORT_COMPLETE: {
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage:
							currentProgress?.exportType === 'database'
								? __( 'Database export completed' )
								: __( 'Site export completed' ),
						progress: 100,
					},
				} ) );
				break;
			}
			case ExportEvents.EXPORT_ERROR: {
				setExportState( ( { [ siteId ]: currentProgress, ...rest } ) => ( {
					...rest,
					[ siteId ]: {
						...currentProgress,
						statusMessage: __( 'Export failed. Please try again.' ),
						progress: 100,
						isError: true,
					},
				} ) );
				break;
			}
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
			clearExportState,
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
			clearExportState,
		]
	);

	return (
		<ImportExportContext.Provider value={ context }>{ children }</ImportExportContext.Provider>
	);
};

export const useImportExport = () => useContext( ImportExportContext );
