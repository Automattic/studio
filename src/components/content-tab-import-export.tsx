import { speak } from '@wordpress/a11y';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf, __ } from '@wordpress/i18n';
import { Icon, download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useRef } from 'react';
import { ACCEPTED_IMPORT_FILE_TYPES, STUDIO_DOCS_URL_IMPORT_EXPORT } from '../constants';
import { useConfirmationDialog } from '../hooks/use-confirmation-dialog';
import { useDragAndDropFile } from '../hooks/use-drag-and-drop-file';
import { useImportExport } from '../hooks/use-import-export';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import ProgressBar from './progress-bar';
import Tooltip from './tooltip';

interface ContentTabImportExportProps {
	selectedSite: SiteDetails;
}

export const ExportSite = ( { selectedSite }: { selectedSite: SiteDetails } ) => {
	const { exportState, exportFullSite, exportDatabase, importState } = useImportExport();
	const { [ selectedSite.id ]: currentProgress } = exportState;
	const isSiteImporting = importState[ selectedSite.id ]?.progress < 100;
	const siteNotReadyForExportMessage = __(
		'This site is being imported. Please wait for the import to finish before you export it.'
	);

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
				<div className="flex flex-col gap-4">
					<ProgressBar value={ currentProgress.progress } maxValue={ 100 } />
					<div className="text-a8c-gray-70 a8c-body">{ currentProgress.statusMessage }</div>
				</div>
			) : (
				<div className="flex flex-row gap-4">
					<Tooltip text={ siteNotReadyForExportMessage } disabled={ ! isSiteImporting }>
						<Button
							onClick={ () => handleExport( exportFullSite ) }
							variant="primary"
							disabled={ isSiteImporting }
						>
							{ __( 'Export entire site' ) }
						</Button>
					</Tooltip>
					<Tooltip text={ siteNotReadyForExportMessage } disabled={ ! isSiteImporting }>
						<Button
							onClick={ () => handleExport( exportDatabase ) }
							type="submit"
							variant="secondary"
							className={ cx( isSiteImporting ? '' : '!text-a8c-blueberry !shadow-a8c-blueberry' ) }
							disabled={ isSiteImporting }
						>
							{ __( 'Export database' ) }
						</Button>
					</Tooltip>
				</div>
			) }
		</div>
	);
};

const InitialImportButton = ( {
	children,
	isInitial,
	openFileSelector,
	disabled,
}: {
	children: React.ReactNode;
	isInitial: boolean;
	openFileSelector: () => void;
	disabled?: boolean;
} ) =>
	isInitial ? (
		<Button
			variant="icon"
			className="w-full [&>div.border-zinc-300]:hover:border-a8c-blueberry"
			onClick={ openFileSelector }
			disabled={ disabled }
		>
			{ children }
		</Button>
	) : (
		<div className="w-full">{ children }</div>
	);

const ImportSite = ( props: { selectedSite: SiteDetails } ) => {
	const { __ } = useI18n();
	const { startServer, loadingServer } = useSiteDetails();
	const { importState, importFile, clearImportState, exportState } = useImportExport();
	const { [ props.selectedSite.id ]: currentProgress } = importState;
	const isSiteExporting =
		exportState[ props.selectedSite?.id ] && exportState[ props.selectedSite?.id ].progress < 100;

	const importConfirmation = useConfirmationDialog( {
		message: sprintf( __( 'Overwrite %s?' ), props.selectedSite.name ),
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
			importConfirmation( () => importFile( file, props.selectedSite ) );
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
			await importFile( file, props.selectedSite );
			clearImportFileInput();
		} );
	};
	const openSite = async () => {
		if ( ! props.selectedSite.running ) {
			speak( __( 'Starting the server before opening the site link' ) );
			await startServer( props.selectedSite.id );
		}
		getIpcApi().openSiteURL( props.selectedSite.id, '', { autoLogin: false } );
	};
	const clearImportFileInput = () => {
		if ( inputFileRef.current ) {
			inputFileRef.current.value = '';
		}
	};
	const onStartAgain = () => {
		clearImportState( props.selectedSite.id );
		clearImportFileInput();
	};

	const startLoadingCursorClassName =
		loadingServer[ props.selectedSite.id ] && 'animate-pulse duration-100 cursor-wait';

	const isImporting = currentProgress?.progress < 100;
	const isImported = currentProgress?.progress === 100 && ! isDraggingOver;
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
					disabled={ isSiteExporting }
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
	return (
		<div className="flex flex-col p-8 gap-8">
			<ImportSite selectedSite={ selectedSite } />
			<ExportSite selectedSite={ selectedSite }></ExportSite>
		</div>
	);
}
