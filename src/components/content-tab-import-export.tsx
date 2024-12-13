import { speak } from '@wordpress/a11y';
import { Notice } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf, __ } from '@wordpress/i18n';
import { Icon, download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useRef, useState } from 'react';
import { STUDIO_DOCS_URL_IMPORT_EXPORT, ACCEPTED_IMPORT_FILE_TYPES } from '../constants';
import { useSyncSites } from '../hooks/sync-sites/sync-sites-context';
import { useConfirmationDialog } from '../hooks/use-confirmation-dialog';
import { useDragAndDropFile } from '../hooks/use-drag-and-drop-file';
import { useImportExport } from '../hooks/use-import-export';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import ProgressBar from './progress-bar';
import { Tooltip } from './tooltip';

interface ContentTabImportExportProps {
	selectedSite: SiteDetails;
}

export const ExportSite = ( {
	selectedSite,
	isAnySiteSyncing,
	isThisSiteSyncing,
}: {
	selectedSite: SiteDetails;
	isAnySiteSyncing: boolean;
	isThisSiteSyncing: boolean;
} ) => {
	const { exportState, exportFullSite, exportDatabase, importState } = useImportExport();
	const { [ selectedSite.id ]: currentProgress } = exportState;
	const isImporting = importState[ selectedSite.id ]?.progress < 100;
	const isExportDisabled = isImporting || isAnySiteSyncing;

	let tooltipText;
	if ( isThisSiteSyncing ) {
		tooltipText = __(
			'This Studio site is syncing. Please wait for the sync to finish before you export it.'
		);
	} else if ( isAnySiteSyncing ) {
		tooltipText = __(
			'Another Studio site is syncing. Please wait for the sync to finish before you export this site.'
		);
	} else if ( isImporting ) {
		tooltipText = __(
			'This Studio site is being imported. Please wait for the import to finish before you export it.'
		);
	}

	const handleExport = async ( exportFunction: typeof exportFullSite | typeof exportDatabase ) => {
		const exportPath = await exportFunction( selectedSite );
		if ( exportPath ) {
			getIpcApi().showItemInFolder( exportPath );
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h4 className="a8c-subtitle-small leading-5">{ __( 'Export' ) }</h4>
				<p className="text-a8c-gray-70 leading-[140%] a8c-helper-text text-[13px]">
					{ __( 'Export your entire site or only the database.' ) }
				</p>
			</div>
			{ currentProgress ? (
				<div className="flex flex-col gap-4 max-w-[300px]">
					<ProgressBar value={ currentProgress.progress } maxValue={ 100 } />
					<div className="text-a8c-gray-70 a8c-body">{ currentProgress.statusMessage }</div>
				</div>
			) : (
				<Tooltip text={ tooltipText } disabled={ ! isExportDisabled } placement="top-start">
					<div className="flex flex-row gap-4">
						<Button
							onClick={ () => handleExport( exportFullSite ) }
							variant="primary"
							disabled={ isExportDisabled }
						>
							{ __( 'Export entire site' ) }
						</Button>
						<Button
							onClick={ () => handleExport( exportDatabase ) }
							type="submit"
							variant="secondary"
							className={ cx(
								isExportDisabled ? '' : '!text-a8c-blueberry !shadow-a8c-blueberry'
							) }
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
	isAnySiteSyncing,
	isThisSiteSyncing,
}: {
	children: React.ReactNode;
	isInitial: boolean;
	openFileSelector: () => void;
	isSiteExporting: boolean;
	isAnySiteSyncing: boolean;
	isThisSiteSyncing: boolean;
} ) => {
	const disabled = isSiteExporting || isAnySiteSyncing;
	let tooltipText;
	if ( isThisSiteSyncing ) {
		tooltipText = __(
			'This Studio site is syncing. Please wait for the sync to finish before you import a backup.'
		);
	} else if ( isAnySiteSyncing ) {
		tooltipText = __(
			'Another Studio site is syncing. Please wait for the sync to finish before you import a backup.'
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
				className={ `w-full 
				${
					disabled
						? '[&>div.border-zinc-300]:border-gray-400 cursor-not-allowed opacity-50'
						: '[&>div.border-zinc-300]:hover:border-a8c-blueberry'
				}` }
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

const ImportSite = ( {
	selectedSite,
	isAnySiteSyncing,
	isThisSiteSyncing,
}: {
	selectedSite: SiteDetails;
	isAnySiteSyncing: boolean;
	isThisSiteSyncing: boolean;
} ) => {
	const { __ } = useI18n();
	const { startServer, loadingServer } = useSiteDetails();
	const { importState, importFile, clearImportState, exportState } = useImportExport();
	const { [ selectedSite.id ]: currentProgress } = importState;
	const isSiteExporting =
		exportState[ selectedSite?.id ] && exportState[ selectedSite?.id ].progress < 100;

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
			importConfirmation( () => importFile( file, selectedSite ) );
		},
	} );
	const inputFileRef = useRef< HTMLInputElement >( null );
	const openFileSelector = async () => {
		inputFileRef.current?.click();
	};
	const onFileSelected = async ( e: React.ChangeEvent< HTMLInputElement > ) => {
		const file = e?.target?.files?.[ 0 ];
		if ( ! file ) {
			return;
		}
		importConfirmation( async () => {
			await importFile( file, selectedSite );
			clearImportFileInput();
		} );
	};
	const openSite = async () => {
		if ( ! selectedSite.running ) {
			speak( __( 'Starting the server before opening the site link' ) );
			await startServer( selectedSite.id );
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

	const startLoadingCursorClassName =
		loadingServer[ selectedSite.id ] &&
		! isAnySiteSyncing &&
		'animate-pulse duration-100 cursor-wait';

	const isImporting = currentProgress?.progress < 100 && ! isAnySiteSyncing;
	const isImported = currentProgress?.progress === 100 && ! isDraggingOver && ! isAnySiteSyncing;
	const isInitial = ! isImporting && ! isImported;
	return (
		<div className={ cx( 'flex flex-col w-full', startLoadingCursorClassName ) }>
			<div className="a8c-subtitle-small mb-1">{ __( 'Import' ) }</div>
			<div className="text-a8c-gray-70 a8c-body mb-4">
				{ createInterpolateElement(
					__( 'Import a Jetpack backup or a .sql database file. <button>Learn more</button>' ),
					{
						button: (
							<Button
								variant="link"
								onClick={ () => getIpcApi().openURL( STUDIO_DOCS_URL_IMPORT_EXPORT ) }
							/>
						),
					}
				) }
			</div>
			<div ref={ dropRef } className="w-full">
				<InitialImportButton
					isInitial={ isInitial }
					openFileSelector={ openFileSelector }
					isSiteExporting={ isSiteExporting }
					isAnySiteSyncing={ isAnySiteSyncing }
					isThisSiteSyncing={ isThisSiteSyncing }
				>
					<div
						className={ cx(
							'h-36 w-full rounded-sm border border-zinc-300 flex-col justify-center items-center inline-flex',
							isDraggingOver && ! isImporting && 'border-a8c-blueberry bg-a8c-gray-0'
						) }
					>
						{ isImporting && (
							<>
								<div className="w-[240px]">
									<ProgressBar value={ currentProgress.progress } maxValue={ 100 } />
								</div>
								<div className="text-a8c-gray-70 a8c-body mt-4">
									{ currentProgress.statusMessage }
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
								<Icon className="!fill-a8c-gray-70" icon={ download } />
								<span className="text-a8c-gray-70 a8c-body-small mt-1">
									{ isDraggingOver
										? __( 'Drop file' )
										: __( 'Drag a file here, or click to select a file' ) }
								</span>
							</>
						) }
					</div>
				</InitialImportButton>
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
	const [ isSupported, setIsSupported ] = useState< boolean | null >( null );
	const { isAnySitePulling, isAnySitePushing, isSiteIdPulling, isSiteIdPushing, connectedSites } =
		useSyncSites();
	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;
	const isPulling = connectedSites.some( ( site ) => isSiteIdPulling( selectedSite.id, site.id ) );
	const isPushing = connectedSites.some( ( site ) => isSiteIdPushing( selectedSite.id, site.id ) );
	const isThisSiteSyncing = isPulling || isPushing;

	useEffect( () => {
		getIpcApi()
			.isImportExportSupported( selectedSite.id )
			.then( ( result ) => {
				setIsSupported( result );
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
			<ImportSite
				selectedSite={ selectedSite }
				isAnySiteSyncing={ isAnySiteSyncing }
				isThisSiteSyncing={ isThisSiteSyncing }
			/>
			<ExportSite
				selectedSite={ selectedSite }
				isAnySiteSyncing={ isAnySiteSyncing }
				isThisSiteSyncing={ isThisSiteSyncing }
			/>
		</div>
	);
}
