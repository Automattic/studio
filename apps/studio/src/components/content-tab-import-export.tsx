import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { speak } from '@wordpress/a11y';
import { Notice } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { Icon, download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useRef, useState } from 'react';
import Button from 'src/components/button';
import { ClearAction } from 'src/components/clear-action';
import { ErrorIcon } from 'src/components/error-icon';
import { LearnMoreLink } from 'src/components/learn-more';
import ProgressBar from 'src/components/progress-bar';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useConfirmationDialog } from 'src/hooks/use-confirmation-dialog';
import { useDragAndDropFile } from 'src/hooks/use-drag-and-drop-file';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync';
import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';

interface ContentTabImportExportProps {
	selectedSite: SiteDetails;
}

const ExportSite = ( {
	selectedSite,
	isThisSiteSyncing,
}: {
	selectedSite: SiteDetails;
	isThisSiteSyncing: boolean;
} ) => {
	const { __ } = useI18n();
	const { exportState, exportFullSite, exportDatabase, importState, clearExportState } =
		useImportExport();
	const { [ selectedSite.id ]: currentProgress } = exportState;
	const isImporting = importState[ selectedSite.id ]?.progress < 100;
	const isExportDisabled = isImporting || isThisSiteSyncing;
	const isExporting = currentProgress && currentProgress.progress < 100;
	const isExportCompleted = currentProgress && currentProgress.progress === 100;
	const isExportError = currentProgress && currentProgress.isError;

	let tooltipText;
	if ( isThisSiteSyncing ) {
		tooltipText = __(
			'This Studio site is syncing. Please wait for the sync to finish before you export it.'
		);
	} else if ( isImporting ) {
		tooltipText = __(
			'This Studio site is being imported. Please wait for the import to finish before you export it.'
		);
	}

	const handleClearExport = () => {
		clearExportState( selectedSite.id );
	};

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h4 className="a8c-subtitle-small leading-5">{ __( 'Export' ) }</h4>
				<p className="text-frame-text-secondary leading-[140%] a8c-helper-text text-[13px]">
					{ __( 'Export your entire site or only the database.' ) }
				</p>
			</div>
			{ currentProgress ? (
				<div className="flex flex-col gap-4 max-w-[300px]">
					{ isExporting && (
						<>
							<ProgressBar />
							<div className="text-frame-text-secondary a8c-body">
								{ currentProgress.statusMessage }
							</div>
						</>
					) }
					{ isExportCompleted && ! isExportError && (
						<ClearAction onClick={ handleClearExport }>
							{ currentProgress.statusMessage }
						</ClearAction>
					) }
					{ isExportError && (
						<ClearAction onClick={ handleClearExport } isError>
							{ currentProgress.statusMessage }
						</ClearAction>
					) }
				</div>
			) : (
				<Tooltip text={ tooltipText } disabled={ ! isExportDisabled } placement="top-start">
					<div className="flex flex-row gap-4">
						<Button
							onClick={ () => exportFullSite( selectedSite ) }
							variant="primary"
							disabled={ isExportDisabled }
						>
							{ __( 'Export entire site' ) }
						</Button>
						<Button
							onClick={ () => exportDatabase( selectedSite ) }
							type="submit"
							variant="secondary"
							className={ cx( isExportDisabled ? '' : '!text-frame-theme !shadow-frame-theme' ) }
							disabled={ isExportDisabled }
						>
							{ __( 'Export database' ) }
						</Button>
					</div>
				</Tooltip>
			) }
		</div>
	);
};

const InitialImportButton = ( {
	children,
	isInitial,
	openFileSelector,
	isSiteExporting,
	isThisSiteSyncing,
}: {
	children: React.ReactNode;
	isInitial: boolean;
	openFileSelector: () => void;
	isSiteExporting: boolean;
	isThisSiteSyncing: boolean;
} ) => {
	const { __ } = useI18n();
	const disabled = isSiteExporting || isThisSiteSyncing;
	let tooltipText;
	if ( isThisSiteSyncing ) {
		tooltipText = __(
			'This Studio site is syncing. Please wait for the sync to finish before you import a backup.'
		);
	} else if ( isSiteExporting ) {
		tooltipText = __(
			'This Studio site is exporting. Please wait for the export to finish before you import a backup.'
		);
	}
	return isInitial ? (
		<Tooltip className="w-full" text={ tooltipText } disabled={ ! disabled }>
			<Button
				variant="icon"
				className={ cx(
					'w-full',
					disabled
						? '[&>div.border-zinc-300]:border-frame-border cursor-not-allowed opacity-50'
						: '[&>div.border-zinc-300]:hover:border-frame-theme'
				) }
				onClick={ openFileSelector }
				disabled={ disabled }
			>
				{ children }
			</Button>
		</Tooltip>
	) : (
		<div className="w-full">{ children }</div>
	);
};

const isValidImportFile = ( file: File ): boolean => {
	const fileName = file.name.toLowerCase();
	return (
		ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) => fileName.endsWith( ext ) ) ||
		fileName.endsWith( '.sql' )
	);
};

const ImportSite = ( {
	selectedSite,
	isThisSiteSyncing,
}: {
	selectedSite: SiteDetails;
	isThisSiteSyncing: boolean;
} ) => {
	const { __ } = useI18n();
	const { startServer, loadingServer } = useSiteDetails();
	const { importState, importFile, clearImportState, exportState } = useImportExport();
	const { [ selectedSite.id ]: currentProgress } = importState;
	const isSiteExporting =
		exportState[ selectedSite?.id ] && exportState[ selectedSite?.id ].progress < 100;
	const [ fileError, setFileError ] = useState< string | null >( null );

	const importConfirmation = useConfirmationDialog( {
		message: sprintf( __( 'Overwrite %s?' ), selectedSite.name ),
		checkboxLabel: __( "Don't ask again" ),
		detail: __( 'Importing a backup will replace the existing files and database for your site.' ),
		confirmButtonLabel: __( 'Import' ),
		localStorageKey: 'dontShowImportConfirmation',
	} );

	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			if ( isImporting ) {
				return;
			}
			if ( ! isValidImportFile( file ) ) {
				setFileError(
					__(
						'This file type is not supported. Please use a .zip, .gz, .tar, .tar.gz, .wpress, or .sql file.'
					)
				);
				return;
			}
			setFileError( null );
			void importConfirmation( () => importFile( file, selectedSite ) );
		},
	} );

	useEffect( () => {
		if ( isDraggingOver && fileError ) {
			setFileError( null );
		}
	}, [ isDraggingOver, fileError ] );

	const inputFileRef = useRef< HTMLInputElement >( null );
	const openFileSelector = async () => {
		inputFileRef.current?.click();
	};
	const onFileSelected = async ( e: React.ChangeEvent< HTMLInputElement > ) => {
		const file = e?.target?.files?.[ 0 ];
		if ( ! file ) {
			return;
		}
		clearImportFileInput();
		void importConfirmation( async () => {
			await importFile( file, selectedSite );
		} );
	};
	const openSite = async () => {
		if ( ! selectedSite.running ) {
			speak( __( 'Starting the server before opening the site link' ) );
			await startServer( selectedSite );
		}
		getIpcApi().openSiteURL( selectedSite.id, '', { autoLogin: false } );
	};
	const clearImportFileInput = () => {
		if ( inputFileRef.current ) {
			inputFileRef.current.value = '';
		}
	};
	const onStartAgain = () => {
		clearImportState( selectedSite.id );
		clearImportFileInput();
	};

	const startLoadingCursorClassName = loadingServer[ selectedSite.id ] && 'cursor-wait';

	const isImporting = currentProgress?.progress < 100 && ! isThisSiteSyncing;
	const isImported = currentProgress?.progress === 100 && ! isDraggingOver && ! isThisSiteSyncing;
	const isInitial = ! isImporting && ! isImported;
	return (
		<div className={ cx( 'flex flex-col w-full', startLoadingCursorClassName ) }>
			<div className="a8c-subtitle-small mb-1">{ __( 'Import' ) }</div>
			<div className="text-frame-text-secondary a8c-body mb-4">
				{ createInterpolateElement(
					__(
						'Import a Jetpack backup, a full-site backup in another format, or a .sql database file. <learn_more_link />'
					),
					{
						learn_more_link: <LearnMoreLink docsLinksKey="docsImportExport" />,
					}
				) }
			</div>
			<div ref={ dropRef } className="w-full">
				<InitialImportButton
					isInitial={ isInitial }
					openFileSelector={ openFileSelector }
					isSiteExporting={ isSiteExporting }
					isThisSiteSyncing={ isThisSiteSyncing }
				>
					<div
						className={ cx(
							'h-36 w-full rounded-sm border border-frame-border flex-col justify-center items-center inline-flex',
							isDraggingOver && ! isImporting && 'border-frame-theme bg-frame-surface'
						) }
					>
						{ isImporting && (
							<>
								<div className="w-[240px]">
									<ProgressBar />
								</div>
								<div className="text-frame-text-secondary a8c-body mt-4">
									{ currentProgress.statusMessage || __( 'Importing…' ) }
								</div>
							</>
						) }
						{ isImported && (
							<>
								<span className="text-balck a8c-body">{ __( 'Import complete!' ) }</span>
								<div className="flex gap-2 mt-4">
									<Button
										className={ cx( startLoadingCursorClassName ) }
										variant="primary"
										onClick={ openSite }
										disabled={ !! loadingServer[ selectedSite.id ] }
									>
										{ __( 'Open site ↗' ) }
									</Button>
									<Button variant="link" className="!px-2.5 !py-2" onClick={ onStartAgain }>
										{ __( 'Start again' ) }
									</Button>
								</div>
							</>
						) }
						{ isInitial && (
							<>
								<Icon className="!fill-frame-text-secondary" icon={ download } />
								<span className="text-frame-text-secondary a8c-body-small mt-1">
									{ isDraggingOver
										? __( 'Drop file' )
										: __( 'Drag a file here, or click to select a file' ) }
								</span>
							</>
						) }
					</div>
				</InitialImportButton>
				{ fileError && (
					<div className="flex items-start gap-1 text-xs text-red-500 mt-2">
						<ErrorIcon className="shrink-0 mt-px fill-current" />
						<span className="text-left">{ fileError }</span>
					</div>
				) }
			</div>
			<input
				ref={ inputFileRef }
				className="hidden"
				type="file"
				data-testid="backup-file"
				accept={ `${ ACCEPTED_IMPORT_FILE_TYPES.join( ',' ) },.sql` }
				onChange={ onFileSelected }
			/>
		</div>
	);
};

export function ContentTabImportExport( { selectedSite }: ContentTabImportExportProps ) {
	const { __ } = useI18n();
	const [ isSupported, setIsSupported ] = useState< boolean | null >( null );
	const { user } = useAuth();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const isPullingLocally = useRootSelector( ( state ) =>
		connectedSites.some( ( site ) =>
			syncOperationsSelectors.selectIsSiteIdPullingLocally( selectedSite.id, site.id )( state )
		)
	);
	// Only block import/export while the local machine is actively involved in sync.
	// After the backup upload completes, the push continues remotely and should not block import/export.
	const isUploadingPushBackup = useRootSelector( ( state ) =>
		connectedSites.some( ( site ) =>
			syncOperationsSelectors.selectIsSiteIdPushingLocally( selectedSite.id, site.id )( state )
		)
	);
	const isThisSiteSyncing = isPullingLocally || isUploadingPushBackup;

	useEffect( () => {
		getIpcApi()
			.isImportExportSupported( selectedSite.id )
			.then( ( result ) => {
				setIsSupported( result );
			} )
			.catch( () => {
				setIsSupported( false );
			} );
	}, [ selectedSite.id, selectedSite.running ] );

	if ( isSupported === null ) {
		return null;
	}

	if ( ! isSupported ) {
		return (
			<div className="flex flex-col p-8">
				<Notice status="warning" isDismissible={ false }>
					<span className="font-bold">
						{ __( 'Import / Export is not available for this site' ) }
					</span>
					<br />
					{ __( 'This feature is only available for sites using the default SQLite integration.' ) }
				</Notice>
			</div>
		);
	}

	return (
		<div className="flex flex-col p-8 gap-8" data-testid="import-export-supported">
			<ImportSite selectedSite={ selectedSite } isThisSiteSyncing={ isThisSiteSyncing } />
			<ExportSite selectedSite={ selectedSite } isThisSiteSyncing={ isThisSiteSyncing } />
		</div>
	);
}
